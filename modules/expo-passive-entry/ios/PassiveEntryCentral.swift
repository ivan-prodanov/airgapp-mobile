import CoreBluetooth
import CryptoKit
import Foundation
import UIKit

// PassiveEntryCentral — the restorable CoreBluetooth central that holds the link
// to the car for background passive entry (plan Task 2: connect-and-hold only;
// GATT/challenge answering comes in Tasks 5–7).
//
// Owns ONE CBCentralManager with a stable restore identifier so iOS can relaunch
// us into the background on a car BLE event and call willRestoreState. Scans for
// the VCSEC service (background scanning REQUIRES a service filter), matches the
// car by its advertised local name (the same VIN-derived `S<hex>C` token our TS
// scanner uses), connects, and holds.
//
// Logs to two sinks: the JS `log` event (foreground visibility) AND a native
// file (airgapp-native.log) so callbacks that fire while JS is suspended still
// survive to be pulled. A separate file from the TS diagnostics log to avoid
// cross-runtime write interleaving.
final class PassiveEntryCentral: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
  static let serviceUUID = CBUUID(string: "00000211-b2d1-43f0-9b88-960cebf8b91e")
  static let txUUID = CBUUID(string: "00000212-b2d1-43f0-9b88-960cebf8b91e") // write
  static let rxUUID = CBUUID(string: "00000213-b2d1-43f0-9b88-960cebf8b91e") // notify
  static let restoreId = "airgapp.passiveentry"
  // Stable notification ids so a re-post replaces rather than stacks, and so we
  // can withdraw the BT reminder when Bluetooth comes back.
  static let btOffNotifId = "airgapp.notif.bluetooth-off"
  static let btOffRepeatId = "airgapp.notif.bluetooth-off.repeat"
  static let bondRemovedNotifId = "airgapp.notif.bond-removed"
  static let appClosedNotifId = "airgapp.notif.app-closed"
  static let cpdNotifId = "airgapp.notif.cpd-warning"

  // Singleton: the CBCentralManager (with restore id) must be re-created at APP
  // LAUNCH for iOS state restoration to relaunch us in the background — so the
  // AppDelegate subscriber and the JS module both reach the SAME instance here,
  // not a per-call one.
  static let shared = PassiveEntryCentral()
  private static let vinKey = "airgapp.passiveentry.vin"
  // Persisted "the repeating BT-off reminder is already scheduled" flag. Survives
  // relaunch so we schedule the repeat ONCE per off-episode — re-adding the same
  // request each app wake would reset its timer and it might never fire.
  private static let btOffRepeatScheduledKey = "airgapp.passiveentry.btOffRepeatScheduled"
  // The car's CBPeripheral identifier, saved on first connect. Lets us re-acquire
  // it with retrievePeripherals(withIdentifiers:) and hold a STANDING PENDING
  // CONNECT instead of re-scanning — see reestablish().
  private static let peripheralIdKey = "airgapp.passiveentry.peripheralId"
  // WARM SESSION (RESPONSE-15's one actionable link gap). Tesla persists
  // VehicleSessionInfo{epoch, counter, clockTime} per (vin,key,domain) across
  // disconnect AND process death; we threw it away, so every reconnect paid a full
  // ECDH + SessionInfoRequest round trip (~300-600 ms) ON THE CRITICAL PATH of a
  // walk-up. Measured 2026-07-25: a reconnect couldn't answer for 89 s because the
  // handshake waits on the GATT subscribe. Restoring lets us answer IMMEDIATELY.
  // No key material is stored — only the car's PUBLIC key + counters — so
  // UserDefaults (same at-rest protection as the container) is sufficient.
  private static let sessEpochKey = "airgapp.passiveentry.sess.epoch"
  private static let sessCounterKey = "airgapp.passiveentry.sess.counter"
  private static let sessClockKey = "airgapp.passiveentry.sess.clockBase"
  private static let sessWallKey = "airgapp.passiveentry.sess.clockWall"
  private static let sessCarPubKey = "airgapp.passiveentry.sess.carPub"
  // How often the proactive "Bluetooth Disabled" reminder repeats while BT is off,
  // like the official app (posts several times a day even with no interaction).
  private static let btOffRepeatSec: TimeInterval = 4 * 3600

  // Whether passive entry has ever been armed — readable WITHOUT instantiating
  // the central (and thus without creating a CBCentralManager, which would prompt
  // for Bluetooth). The AppDelegate checks this before touching `.shared`, so a
  // fresh install that never armed passive entry gets no launch-time BLE manager.
  static func isArmed() -> Bool {
    let vin = UserDefaults.standard.string(forKey: vinKey)
    return vin?.isEmpty == false
  }

  private var central: CBCentralManager?
  private var peripheral: CBPeripheral?
  private var targetName: String?
  private var wantScan = false
  // Foreground event sink (set by the JS module). nil in a background relaunch,
  // where JS isn't running — then only the file log records events.
  var onLog: ((String) -> Void)?
  // Byte-pipe event sinks (model (b)): in FOREGROUND (pipe mode) native forwards
  // every raw 0213 notification to TS via onFrame and reports link state via
  // onConnectionState; TS runs all command crypto and the passive responder.
  var onFrame: (([UInt8]) -> Void)?
  var onConnectionState: ((String, Int) -> Void)?
  // Fired when the car's LE bond is gone (peerRemovedPairingInformation) — the
  // user forgot the device in iOS Settings. JS flips to the Set-Up state.
  var onBondRemoved: (() -> Void)?
  // Debounce: native keeps retrying, so peerRemoved recurs; report it once until
  // a successful connect clears it.
  private var bondRemovedReported = false
  // Single-writer gate (RESPONSE-12 bridge surface). true = FOREGROUND: native
  // is a dumb byte-pipe, TS signs. false = BACKGROUND: native self-signs the
  // AuthenticationResponse (Hermes is suspended). Default false so a background
  // restoration relaunch is autonomous with no JS.
  private var foregroundActive = false
  private let fileQueue = DispatchQueue(label: "airgapp.passiveentry.filelog")

  // GATT + handshake state
  private var vin = ""
  private var txChar: CBCharacteristic?
  private var rxChar: CBCharacteristic?
  private var blockLength = 20
  private var challenge = [UInt8]()
  private var rxBuffer = [UInt8]()
  private var rxExpected = -1
  // Live session after a successful handshake.
  private var sessionKey: [UInt8]?
  private var counter: UInt32 = 0
  private var epoch = [UInt8]()
  private var clockBase: UInt32 = 0
  private var handshakeWallSec: UInt32 = 0
  private var myPubRaw = [UInt8]()
  private var routingAddress = [UInt8](repeating: 0xab, count: 16)
  // Safety cap: stop answering after this many in one connection, so a wrong
  // seal can't flood VCSEC (the 2026-07-20 wedge lesson). A correct answer
  // unlocks and the car stops challenging well before this.
  private var answersGiven = 0
  private let maxAnswers = 20
  // RESPONSE-11: assert a STANDING DRIVE authorization on EVERY connect, exactly
  // like the official app (q1.java connectionEstablished→G0, gated only on
  // whitelist, NO throttle — confirmed in the decompile). Gated so it can be
  // disabled. (A 3-min throttle was tried 2026-07-23 then removed for parity: the
  // edge-of-range chattiness it fought is harmless, and Tesla re-asserts freely.)
  private let assertStandingDriveOnConnect = true

  override init() {
    super.init()
    // Create the manager up front WITH the restore identifier so restoration is
    // armed. When this instance is built at APP LAUNCH (by the AppDelegate
    // subscriber, before JS), iOS can hand back the restored peripheral via
    // willRestoreState on a background relaunch.
    central = CBCentralManager(
      delegate: self,
      queue: nil,
      options: [CBCentralManagerOptionRestoreIdentifierKey: PassiveEntryCentral.restoreId]
    )
  }

  // True only when iOS woke us into the background (a CoreBluetooth relaunch is
  // delivered with applicationState == .background; a normal user launch is
  // .inactive → .active). This is the single-writer discriminator.
  private var isBackground: Bool { UIApplication.shared.applicationState == .background }

  // Called at app launch (foreground OR background relaunch) by the AppDelegate
  // subscriber. Single-writer by lifecycle: native drives BLE ONLY while
  // backgrounded — on a foreground launch it stays idle so the JS command path
  // owns the one link (two phone centrals to the car = fatal contention). On a
  // background CoreBluetooth relaunch (JS suspended) it resumes with no JS.
  func startIfConfigured() {
    guard let vin = UserDefaults.standard.string(forKey: PassiveEntryCentral.vinKey), !vin.isEmpty else {
      log("startIfConfigured: no armed vin — idle")
      return
    }
    guard isBackground else {
      log("startIfConfigured: foreground launch — deferring to JS (armed for …\(vin.suffix(6)))")
      return
    }
    log("startIfConfigured: background relaunch, armed for vin=…\(vin.suffix(6))")
    start(vin: vin)
  }

  // The VIN-derived advertised local name: "S" + hex(SHA1(utf8(vin))[0:8]) + "C".
  // Byte-for-byte match to src/ble/bleScanName.ts vehicleLocalName.
  static func vehicleLocalName(_ vin: String) -> String {
    let digest = Insecure.SHA1.hash(data: Data(vin.utf8))
    let hex = digest.prefix(8).map { String(format: "%02x", $0) }.joined()
    return "S\(hex)C"
  }

  var isRunning: Bool { peripheral?.state == .connected }

  func start(vin: String) {
    self.vin = vin
    targetName = PassiveEntryCentral.vehicleLocalName(vin)
    wantScan = true
    // Persist the VIN so a background relaunch (JS suspended) can resume via
    // startIfConfigured() without anyone calling start() again.
    UserDefaults.standard.set(vin, forKey: PassiveEntryCentral.vinKey)
    // Ask for notification permission now (foreground), so a later BACKGROUND
    // reminder (BT off, bond removed) already has the grant.
    Notifier.requestAuthIfNeeded()
    log("start vin=…\(vin.suffix(6)) target=\(targetName ?? "?") state=\(stateName(central?.state))")
    if central?.state == .poweredOn { reestablish() }
  }

  func stop() {
    wantScan = false
    // Disarm: clear the persisted VIN so a later relaunch stays idle.
    UserDefaults.standard.removeObject(forKey: PassiveEntryCentral.vinKey)
    central?.stopScan()
    if let p = peripheral { central?.cancelPeripheralConnection(p) }
    peripheral = nil
    log("stop")
  }

  // Let sibling components (CarRegionMonitor) write into the same native log file —
  // it's the only record that survives JS suspension and a background relaunch.
  func logExternal(_ line: String) { log(line) }

  // A geographic region entry (CarRegionMonitor) means the car is near AND iOS has
  // just relaunched/woken us — including after a REBOOT, which CoreBluetooth
  // restoration alone can't survive. Re-arm the link so the walk-up is answered.
  func wakeForRegionEntry() {
    guard let vin = UserDefaults.standard.string(forKey: PassiveEntryCentral.vinKey), !vin.isEmpty else { return }
    // start() is idempotent: sets wantScan + re-arms the standing pending connect.
    start(vin: vin)
  }

  // MARK: - byte-pipe surface (RESPONSE-12 model (b): native moves bytes, TS signs)

  // The single-writer gate. true = FOREGROUND (TS drives crypto via the pipe);
  // false = BACKGROUND (native self-signs). Driven by whoMaySign/AppState in JS.
  func setForegroundResponderActive(_ active: Bool) {
    guard foregroundActive != active else { return }
    foregroundActive = active
    log("foregroundResponderActive=\(active)")
    // Flipping to background while already connected: native needs its OWN
    // session to answer (TS's session key isn't shared), so re-handshake now.
    if !active, let p = peripheral, p.state == .connected, txChar != nil, rxChar != nil {
      sessionKey = nil
      startHandshake(p)
    }
  }

  // Raw write to 0212 for the TS byte-pipe. `bytes` are ALREADY framed (2-byte BE
  // length prefix) by TS bleFraming — native adds NOTHING, just splits to the
  // negotiated write size and writes .withResponse.
  func writeRaw(_ bytes: [UInt8]) {
    guard let tx = txChar, let p = peripheral, p.state == .connected else {
      log("writeRaw: no connected tx"); return
    }
    var off = 0
    while off < bytes.count {
      let end = min(off + blockLength, bytes.count)
      p.writeValue(Data(bytes[off..<end]), for: tx, type: .withResponse)
      off = end
    }
  }

  // (state, mtu) for TS to gate its handshake + seed blockLength. `mtu` is the
  // negotiated ATT MTU (write-payload-max + 3) so TS's existing `mtu-3` math
  // lands on the correct chunk size.
  func connectionSnapshot() -> (state: String, mtu: Int) {
    let ready = peripheral?.state == .connected && txChar != nil && rxChar != nil
    return (ready ? "connected" : stateName(central?.state), blockLength + 3)
  }

  private func reportConnectionState() {
    let s = connectionSnapshot()
    onConnectionState?(s.state, s.mtu)
  }

  // The car ADVERTISES the 16-bit service UUID 1122 (confirmed on-car
  // 2026-07-22: `advServices=[1122]`), NOT the full GATT service 00000211. This
  // is the filter to scan on — and crucially it works in the BACKGROUND, where
  // iOS forbids nil-scan. (The GATT service 00000211 is still what we read/write
  // characteristics on once connected; it just isn't in the advert.)
  static let advertisedServiceUUID = CBUUID(string: "1122")

  // reestablish — get the link back UP. Prefers a STANDING PENDING CONNECT over a
  // scan, which is the whole ballgame in the background.
  //
  // WHY (measured on-car 2026-07-25): re-scanning after every disconnect left us
  // DISCONNECTED 72% of the time, with reconnect gaps of 1-8 MINUTES (64/130 over
  // 60s) — because iOS heavily throttles/coalesces background `scanForPeripherals`.
  // A walk-up during a gap can't be answered, which is exactly the "app was in the
  // background and the car didn't unlock" failure.
  //
  // `connect(peripheral)` has NO timeout and is NOT scan-throttled: iOS keeps the
  // pending connection and delivers didConnect the instant the car is in range,
  // even while suspended (with bluetooth-central). This is the documented pattern
  // for reconnecting to a KNOWN peripheral, and the official app does the same —
  // RESPONSE-12 found `retrievePeripheralsWithIdentifiers:` in its binary, i.e. it
  // re-acquires by saved UUID rather than rescanning.
  //
  // Scanning stays as the FIRST-EVER-discovery fallback (no saved identifier yet).
  private func reestablish() {
    guard wantScan else { return }
    if let p = peripheral, p.state == .connected || p.state == .connecting { return }
    if let idStr = UserDefaults.standard.string(forKey: PassiveEntryCentral.peripheralIdKey),
       let uuid = UUID(uuidString: idStr),
       let known = central?.retrievePeripherals(withIdentifiers: [uuid]).first {
      peripheral = known
      known.delegate = self
      central?.stopScan() // a pending connect supersedes any in-flight scan
      log("pending connect (standing, no scan) → \(known.name ?? String(idStr.prefix(8)))")
      central?.connect(known, options: nil)
      return
    }
    beginScan() // never connected before — discover by advert
  }

  private func beginScan() {
    guard wantScan else { return }
    // Don't scan while a peripheral is already live/pending — restoration may have
    // handed us a connected one, and a redundant scan wastes background radio time.
    if let p = peripheral, p.state == .connected || p.state == .connecting { return }
    log("scanning (service 1122, match by name)…")
    central?.scanForPeripherals(withServices: [PassiveEntryCentral.advertisedServiceUUID], options: nil)
  }

  // MARK: - CBCentralManagerDelegate

  func centralManagerDidUpdateState(_ c: CBCentralManager) {
    log("state=\(stateName(c.state))")
    switch c.state {
    case .poweredOn:
      // BT is back — withdraw both reminders (the immediate + the repeating one)
      // and RE-ARM so the next off-episode schedules a fresh proactive reminder.
      Notifier.clear(id: PassiveEntryCentral.btOffNotifId)
      Notifier.clear(id: PassiveEntryCentral.btOffRepeatId)
      UserDefaults.standard.set(false, forKey: PassiveEntryCentral.btOffRepeatScheduledKey)
      reestablish()
    case .poweredOff, .unauthorized:
      // Both mean Phone Key can't use Bluetooth. Tesla fires the SAME copy for
      // .poweredOff(4) AND .unauthorized(3) (BLE permission denied) — RESPONSE-13.
      //
      // PROACTIVE like the official app: one reminder immediately, plus a REPEATING
      // notification iOS delivers on its own every few hours — so it shows several
      // times a day even when the app isn't running/interacted with. Scheduled ONCE
      // per off-episode (a persisted flag), because `.poweredOff` also fires on the
      // initial state callback each launch and re-scheduling would reset the repeat
      // timer. Cleared + re-armed when BT returns.
      let scheduled = UserDefaults.standard.bool(forKey: PassiveEntryCentral.btOffRepeatScheduledKey)
      if PassiveEntryCentral.isArmed() && !scheduled {
        let body = "Phone Key will not work until Bluetooth is enabled"
        Notifier.post(id: PassiveEntryCentral.btOffNotifId, title: "Bluetooth Disabled", body: body)
        Notifier.scheduleRepeating(id: PassiveEntryCentral.btOffRepeatId,
                                   title: "Bluetooth Disabled", body: body,
                                   intervalSec: PassiveEntryCentral.btOffRepeatSec)
        UserDefaults.standard.set(true, forKey: PassiveEntryCentral.btOffRepeatScheduledKey)
      }
    default:
      // resetting / unknown / unsupported — transient; leave the reminders + flag
      // untouched (don't clear, or a flip back to off would re-schedule).
      break
    }
  }

  func centralManager(_ c: CBCentralManager, didDiscover p: CBPeripheral,
                      advertisementData: [String: Any], rssi RSSI: NSNumber) {
    let advName = advertisementData[CBAdvertisementDataLocalNameKey] as? String ?? p.name
    guard let target = targetName, advName == target else { return }
    // Log what the car ACTUALLY advertises — the service UUID(s) here are what a
    // background scan will have to filter on (nil-scan is foreground-only).
    let advServices = (advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID])?
      .map { $0.uuidString }.joined(separator: ",") ?? "none"
    log("discovered \(advName ?? "?") rssi=\(RSSI) advServices=[\(advServices)] → connecting")
    c.stopScan()
    peripheral = p
    p.delegate = nil // GATT wiring lands in a later task
    c.connect(p, options: nil)
  }

  func centralManager(_ c: CBCentralManager, didConnect p: CBPeripheral) {
    log("CONNECTED \(p.name ?? "?") — discovering GATT")
    bondRemovedReported = false // a real connect means the bond is back
    c.stopScan() // we're in; a lingering scan only burns background radio time
    // Remember the peripheral so every future re-establish is a STANDING PENDING
    // CONNECT (not a throttled background scan) — see reestablish().
    UserDefaults.standard.set(p.identifier.uuidString, forKey: PassiveEntryCentral.peripheralIdKey)
    p.delegate = self
    txChar = nil; rxChar = nil; rxBuffer = []; rxExpected = -1
    p.discoverServices([PassiveEntryCentral.serviceUUID])
  }

  // MARK: - CBPeripheralDelegate (GATT + handshake)

  func peripheral(_ p: CBPeripheral, didDiscoverServices error: Error?) {
    guard let svc = p.services?.first(where: { $0.uuid == PassiveEntryCentral.serviceUUID }) else {
      log("no VCSEC service: \(error?.localizedDescription ?? "not found")"); return
    }
    p.discoverCharacteristics([PassiveEntryCentral.txUUID, PassiveEntryCentral.rxUUID], for: svc)
  }

  func peripheral(_ p: CBPeripheral, didDiscoverCharacteristicsFor svc: CBService, error: Error?) {
    for ch in svc.characteristics ?? [] {
      if ch.uuid == PassiveEntryCentral.txUUID { txChar = ch }
      if ch.uuid == PassiveEntryCentral.rxUUID { rxChar = ch }
    }
    guard let tx = txChar, let rx = rxChar else { log("missing tx/rx char"); return }
    blockLength = max(20, p.maximumWriteValueLength(for: .withResponse))
    log("chars ok, blockLength=\(blockLength) — subscribing")
    p.setNotifyValue(true, for: rx)
    _ = tx // silence unused until the write below
  }

  func peripheral(_ p: CBPeripheral, didUpdateNotificationStateFor ch: CBCharacteristic, error: Error?) {
    guard ch.uuid == PassiveEntryCentral.rxUUID else { return }
    if let e = error { log("notify subscribe FAILED: \(e.localizedDescription)"); return }
    // Link is up. Tell TS (it seeds blockLength from mtu and drives its own
    // handshake for commands).
    reportConnectionState()
    // Pipe mode (foreground): TS owns all crypto — do NOT self-handshake.
    // Autonomous mode (background): native is self-sufficient — handshake now so
    // it's ready to answer a walk-up challenge with zero JS.
    if !foregroundActive {
      // Warm session FIRST: a challenge can arrive before the handshake completes
      // (measured: the handshake waits on this very subscribe, which stalled 89 s
      // on a weak link). Restoring lets us answer that challenge immediately.
      restoreWarmSession()
      startHandshake(p)
    }
  }

  private func startHandshake(_ p: CBPeripheral) {
    guard let keyHex = KeychainKey.getKeyHex(), let myPub = VcsecSigner.devicePublicKey(privHex: keyHex) else {
      log("handshake ABORT: no device key stored (run Native key check once)"); return
    }
    // Fixed routing address + random challenge for this handshake.
    var rnd = [UInt8](repeating: 0, count: 16); _ = SecRandomCopyBytes(kSecRandomDefault, 16, &rnd)
    challenge = rnd
    let routing = [UInt8](repeating: 0xab, count: 16)
    let frame = VcsecSigner.sessionInfoRequestFrame(myPubRaw: myPub, routingAddress: routing, challenge: challenge)
    rxBuffer = []; rxExpected = -1
    log("handshake: writing SessionInfoRequest (\(frame.count)B)")
    writeFramed(frame, to: p)
  }

  // 2-byte BIG-ENDIAN length prefix + payload, chunked to blockLength.
  private func writeFramed(_ payload: [UInt8], to p: CBPeripheral) {
    guard let tx = txChar else { return }
    var framed = [UInt8(payload.count >> 8 & 0xff), UInt8(payload.count & 0xff)]
    framed += payload
    var off = 0
    while off < framed.count {
      let end = min(off + blockLength, framed.count)
      p.writeValue(Data(framed[off..<end]), for: tx, type: .withResponse)
      off = end
    }
  }

  func peripheral(_ p: CBPeripheral, didUpdateValueFor ch: CBCharacteristic, error: Error?) {
    guard ch.uuid == PassiveEntryCentral.rxUUID, let data = ch.value else { return }
    let bytes = [UInt8](data)
    // Pipe mode (foreground): forward EVERY raw 0213 notification to TS, which
    // runs the BleReassembler + correlator. Native does no reassembly here.
    if foregroundActive {
      onFrame?(bytes)
      return
    }
    // Autonomous mode (background): native reassembles + handles itself.
    rxBuffer += bytes
    // Read the 2-byte BE length once we have the prefix.
    if rxExpected < 0 && rxBuffer.count >= 2 {
      rxExpected = Int(rxBuffer[0]) << 8 | Int(rxBuffer[1])
    }
    guard rxExpected >= 0, rxBuffer.count >= rxExpected + 2 else { return }
    let frame = Array(rxBuffer[2..<(2 + rxExpected)])
    rxBuffer = []; rxExpected = -1
    handleReply(frame)
  }

  private func handleReply(_ frame: [UInt8]) {
    // A SessionInfo reply (field 15) completes the handshake…
    if let siBytes = VcsecSigner.extractLenField(frame, 15) {
      completeHandshake(frame, siBytes); return
    }
    // A payload(10) is a FromVCSECMessage. Two things we care about inside it:
    guard let payload = VcsecSigner.extractLenField(frame, 10) else { return }
    // (a) Child Presence Detection warning (SAFETY) — FromVCSECMessage.CPDMessage
    // = field 55, whose CPDNotification = field 1 is an enum (1=INITIAL,
    // 2=ESCALATED, 0=NONE). Wire format from the HW4 decompile (vc0.w0/y/a0). The
    // car pushes this over BLE when it detects a child left in the cabin.
    if let cpd = VcsecSigner.extractLenField(payload, 55),
       let level = VcsecSigner.extractVarintField(cpd, 1), level != 0 {
      handleCpdWarning(Int(level))
    }
    // (b) an authenticationRequest(3) is a passive-entry CHALLENGE — answer it.
    if let authReq = VcsecSigner.extractLenField(payload, 3) {
      answerChallenge(authReq); return
    }
    // (c) MEASUREMENT ONLY (no behaviour change): log any OTHER top-level field the
    // car sends us. RESPONSE-15 says we silently ignore the car's probes —
    // AppDeviceInfo (44) and the NI/UWB set (47/48/53/19) — and that the cost of
    // ignoring them is "genuinely unmeasured … bound it by logging before acting".
    // A drive engage that takes seconds while we answer nothing is exactly when we
    // need to know what the car is asking for and how often.
    logUnhandledFields(payload)
    // The car asks for our capabilities (field 44) repeatedly until answered.
    if VcsecSigner.topLevelFieldNumbers(payload).contains(44) { sendAppDeviceInfo() }
  }

  // Fields we already understand; everything else is worth seeing while we chase
  // the drive-engage latency.
  private static let knownPayloadFields: Set<Int> = [1 /*vehicleStatus*/, 3 /*authRequest*/,
                                                     4 /*commandStatus*/, 55 /*CPDMessage*/]

  private func logUnhandledFields(_ payload: [UInt8]) {
    let fields = VcsecSigner.topLevelFieldNumbers(payload)
      .filter { !PassiveEntryCentral.knownPayloadFields.contains($0) }
    guard !fields.isEmpty else { return }
    let names = fields.map { f -> String in
      switch f {
      case 44: return "44=AppDeviceInfoRequest"
      case 47: return "47=NISessionRequest"
      case 48: return "48=NISessionStop"
      case 53: return "53=NIBatchRequest"
      case 19: return "19=FiraCapabilitiesRequest"
      case 39: return "39=UnsecureNotification"
      default: return "\(f)"
      }
    }
    log("car PROBE (unanswered): [\(names.joined(separator: ", "))]")
  }

  // MARK: - warm session (persist / restore across disconnect + process death)

  private var carPubRaw = [UInt8]()

  private func persistSession() {
    guard !epoch.isEmpty, !carPubRaw.isEmpty else { return }
    let d = UserDefaults.standard
    d.set(VcsecSigner.hex(epoch), forKey: PassiveEntryCentral.sessEpochKey)
    d.set(Int(counter), forKey: PassiveEntryCentral.sessCounterKey)
    d.set(Int(clockBase), forKey: PassiveEntryCentral.sessClockKey)
    d.set(Int(handshakeWallSec), forKey: PassiveEntryCentral.sessWallKey)
    d.set(VcsecSigner.hex(carPubRaw), forKey: PassiveEntryCentral.sessCarPubKey)
  }

  // Rebuild a signing-capable session from disk so a challenge arriving BEFORE the
  // fresh handshake completes can still be answered. The handshake still runs and
  // re-anchors everything (see completeHandshake's merge) — this only wins the race.
  //
  // Deliberately conservative: if the car rotated its epoch or its clock moved
  // differently from wall time, our early answer is simply rejected and the car
  // re-challenges at ~1 Hz, by which point the fresh session has landed. That is
  // never worse than today's behaviour (no answer at all until the handshake).
  private func restoreWarmSession() {
    guard sessionKey == nil else { return }
    let d = UserDefaults.standard
    guard let epochHex = d.string(forKey: PassiveEntryCentral.sessEpochKey),
          let carPubHex = d.string(forKey: PassiveEntryCentral.sessCarPubKey),
          let keyHex = KeychainKey.getKeyHex(),
          let myPub = VcsecSigner.devicePublicKey(privHex: keyHex) else { return }
    let carPub = VcsecSigner.unhex(carPubHex)
    guard let sk = VcsecSigner.ecdhSessionKey(myPriv: VcsecSigner.unhex(keyHex), peerPub: carPub) else { return }
    sessionKey = sk
    carPubRaw = carPub
    myPubRaw = myPub
    epoch = VcsecSigner.unhex(epochHex)
    counter = UInt32(max(0, d.integer(forKey: PassiveEntryCentral.sessCounterKey)))
    clockBase = UInt32(max(0, d.integer(forKey: PassiveEntryCentral.sessClockKey)))
    handshakeWallSec = UInt32(max(0, d.integer(forKey: PassiveEntryCentral.sessWallKey)))
    answersGiven = 0
    log("warm session restored epoch=\(epochHex.prefix(8)) counter=\(counter) — can answer before handshake")
  }

  private func handleCpdWarning(_ level: Int) {
    log("CPD WARNING level=\(level) (1=initial,2=escalated) — child detected in car")
    PassiveEntryCentral.postCpdWarning()
  }

  // Post the "Child detected in car" alert (RESPONSE-13 copy). Stable id → a
  // repeat/escalation replaces + re-alerts; NO debounce (a child-in-car warning
  // SHOULD keep nagging). Static so the JS foreground path posts identically.
  // (The official app uses the critical-alerts entitlement to pierce silent/DND;
  // we don't hold it, so this is a normal high-priority notification.)
  static func postCpdWarning() {
    Notifier.post(id: cpdNotifId,
                  title: "Child detected in car",
                  body: "Return to your vehicle immediately.")
  }

  private func completeHandshake(_ frame: [UInt8], _ siBytes: [UInt8]) {
    let sig = VcsecSigner.extractLenField(frame, 13)
    let tagField = sig.flatMap { VcsecSigner.extractLenField($0, 6) }.flatMap { VcsecSigner.extractLenField($0, 1) }
    guard let si = VcsecSigner.parseSessionInfo(siBytes),
          let keyHex = KeychainKey.getKeyHex(),
          let sk = VcsecSigner.ecdhSessionKey(myPriv: VcsecSigner.unhex(keyHex), peerPub: si.publicKey),
          let myPub = VcsecSigner.devicePublicKey(privHex: keyHex) else {
      log("handshake parse/ECDH failed"); return
    }
    let want = VcsecSigner.sessionInfoHmac(sessionKey: sk, vin: vin, challenge: challenge, sessionInfoBytes: siBytes)
    let hmacOK = tagField != nil && VcsecSigner.hex(want) == VcsecSigner.hex(tagField!)
    // Only adopt session state from an AUTHENTICATED SessionInfo (HMAC bound to
    // the challenge WE sent). The car also pushes unsolicited SessionInfo frames
    // whose HMAC won't match our challenge — adopting their counter/epoch would
    // desync us and make the next answer fail (or be a push-based desync vector).
    // Keep the verified session; wait for a real handshake reply.
    guard hmacOK else {
      // NOT necessarily junk. When the car REJECTS one of our signed frames (a
      // counter/epoch fault) it pushes a SessionInfo back so we can resync — and
      // that one is NOT bound to our handshake challenge, so the HMAC check can't
      // pass. RESPONSE-15 lists the required behaviour explicitly:
      // "fault-6 → swap epoch/counter IN PLACE with no teardown".
      //
      // MEASURED 2026-07-26: blanket-rejecting these stranded us desynced — the car
      // sat at counter 1284 while we kept signing 1285+, every frame refused, the
      // car reporting no key, until a disconnect forced a fresh handshake. That is
      // a multi-second "place your key card" window on a drive attempt.
      //
      // So: if a session is already ESTABLISHED, treat it as a resync and adopt the
      // car's counter/epoch in place. We never derive a session KEY from an
      // unauthenticated frame (the key comes from the car's static public key we
      // already hold), and a bogus counter is self-correcting — the next frame gets
      // refused and the car sends another SessionInfo. With no session established
      // we still refuse, since then it would be load-bearing.
      guard sessionKey != nil else {
        log("SessionInfo REJECTED (hmac mismatch, no live session) counter=\(si.counter)")
        return
      }
      let before = counter
      counter = si.counter
      epoch = si.epoch
      clockBase = si.clockTime
      handshakeWallSec = UInt32(Date().timeIntervalSince1970)
      persistSession()
      log("SessionInfo RESYNC (fault path): counter \(before) → \(si.counter) epoch=\(VcsecSigner.hex(si.epoch).prefix(8)) — swapped in place, no teardown")
      return
    }
    // MERGE with any warm session (RESPONSE-15 / P1-3): take the HIGHER counter
    // only when the epoch is byte-identical; on an epoch change adopt the car's
    // values WHOLESALE. A naive max() across a rotation is the one thing that
    // would break signing.
    var mergedCounter = si.counter
    if !epoch.isEmpty, epoch == si.epoch, counter > si.counter {
      mergedCounter = counter
      log("warm merge: keeping local counter \(counter) > car \(si.counter) (same epoch)")
    }
    sessionKey = sk; counter = mergedCounter; epoch = si.epoch
    clockBase = si.clockTime; handshakeWallSec = UInt32(Date().timeIntervalSince1970)
    myPubRaw = myPub; carPubRaw = si.publicKey; answersGiven = 0
    persistSession()
    log("HANDSHAKE ✓ epoch=\(VcsecSigner.hex(si.epoch).prefix(8)) counter=\(counter)\(counter != si.counter ? " (car said \(si.counter))" : "") clock=\(si.clockTime) hmacOK=true")
    // RESPONSE-11: proactively assert a standing DRIVE authorization on connect,
    // matching the official app. Harmless when exterior (the car ignores an
    // out-of-zone DRIVE); pre-authorizes drive once it localizes us inside.
    assertStandingDrive()
    // Answer the capability probe the car keeps sending (measured 6+/session).
    sendAppDeviceInfo()
  }

  private func answerChallenge(_ authReq: [UInt8]) {
    guard sessionKey != nil, peripheral != nil else { return }
    guard answersGiven < maxAnswers else { return }
    // requestedLevel (field 3 of AuthenticationRequest); default DRIVE(2).
    let level = VcsecSigner.extractVarintField(authReq, 3) ?? 2
    // inner = UnsignedMessage{ authenticationResponse{ level, distance=0, rejection=0 } }
    let inner: [UInt8] = [0x1a, 0x06, 0x08, UInt8(truncatingIfNeeded: level), 0x10, 0x00, 0x18, 0x00]
    answersGiven += 1
    sendSealed(inner: inner, label: "auth ANSWERED #\(answersGiven) level=\(level)")
  }

  // AppDeviceInfo — answer the car's capability probe (RESPONSE-15 item 7).
  //
  // MEASURED on-car 2026-07-25: the car asks us for this repeatedly (FromVCSEC
  // field 44, 6+ times per session) and we never replied, so it kept asking. We
  // declare UWB unavailable so it stops waiting on a ranging session that will
  // never come (we never bond, so background NI ranging is out — by choice).
  //
  // Wire shape from the HW4 decompile, all field numbers verified, none guessed:
  //   UnsignedMessage.appDeviceInfo = 40                     (vc0/e3.java:290)
  //   AppDeviceInfo{ 2=os, 3=UWBAvailable, 5=batchedNISessions } (vc0/f.java)
  //   AppOperatingSystem.IOS = 2                              (vc0/k.java)
  //   UWBAvailability.UNAVAILABLE_UNSUPPORTED_DEVICE = 2      (vc0/b3.java)
  // batchedNISessionsSupported=false is the proto identity → omitted on the wire.
  private func sendAppDeviceInfo() {
    guard sessionKey != nil, peripheral != nil else { return }
    // AppDeviceInfo{ os=IOS(2), UWBAvailable=UNSUPPORTED_DEVICE(2) }
    let info: [UInt8] = [0x10, 0x02, 0x18, 0x02]
    // UnsignedMessage{ appDeviceInfo(40) = info } — tag 40<<3|2 = 322 → 0xc2 0x02
    var inner: [UInt8] = [0xc2, 0x02, UInt8(info.count)]
    inner += info
    sendSealed(inner: inner, label: "AppDeviceInfo (UWB unsupported)")
  }

  // Seal `inner` with the live session and write it. Shared by the standing-DRIVE
  // assert, the challenge answer and AppDeviceInfo so the counter bump + persist
  // happen in exactly one place.
  @discardableResult
  private func sendSealed(inner: [UInt8], label: String) -> Bool {
    guard let sk = sessionKey, let p = peripheral else { return false }
    counter += 1
    let elapsed = UInt32(Date().timeIntervalSince1970) &- handshakeWallSec
    let expiresAt = clockBase &+ elapsed &+ 5
    var nonce = [UInt8](repeating: 0, count: 12); _ = SecRandomCopyBytes(kSecRandomDefault, 12, &nonce)
    guard let r = VcsecSigner.sealFrame(sessionKey: sk, vin: vin, epoch: epoch, counter: counter,
                                        expiresAt: expiresAt, routingAddress: routingAddress,
                                        myPubRaw: myPubRaw, nonce: nonce, flags: 0, uuid: [0x00],
                                        inner: inner) else {
      log("\(label): seal failed"); return false
    }
    // Persist the bumped counter BEFORE the write goes out (RESPONSE-15) so a
    // crash mid-write can never replay it.
    persistSession()
    log("\(label) sent counter=\(counter) out=\(r.frame.count)B")
    writeFramed(r.frame, to: p)
    return true
  }

  // RESPONSE-11: the proactive standing-DRIVE assertion (VCSEC q1.java G0). One
  // byte from the unlock inner — authenticationLevel = DRIVE(2). The car holds it
  // as our standing level and enables drive once it localizes us inside + a drive
  // trigger (brake). Uses the same routable seal as the challenge answer.
  private func assertStandingDrive() {
    guard assertStandingDriveOnConnect else { return }
    // UnsignedMessage{ authenticationResponse{ level=DRIVE(2), distance=0, rejection=0 } }
    let inner: [UInt8] = [0x1a, 0x06, 0x08, 0x02, 0x10, 0x00, 0x18, 0x00]
    sendSealed(inner: inner, label: "standing DRIVE asserted")
  }

  func centralManager(_ c: CBCentralManager, didFailToConnect p: CBPeripheral, error: Error?) {
    log("connect FAILED: \(error?.localizedDescription ?? "?") → re-arming pending connect")
    if isPeerRemoved(error) { handleBondRemoved() }
    reestablish()
  }

  func centralManager(_ c: CBCentralManager, didDisconnectPeripheral p: CBPeripheral, error: Error?) {
    log("disconnected: \(error?.localizedDescription ?? "clean") → re-arming pending connect")
    txChar = nil; rxChar = nil; rxBuffer = []; rxExpected = -1; sessionKey = nil
    onConnectionState?("disconnected", blockLength + 3)
    if isPeerRemoved(error) { handleBondRemoved() }
    if wantScan { reestablish() }
  }

  // CBError.peerRemovedPairingInformation (code 14) — the user forgot this device
  // in iOS Settings > Bluetooth, so the LE bond is gone. The enrolled KEY is
  // still on the car; only the OS pairing was removed.
  private func isPeerRemoved(_ error: Error?) -> Bool {
    guard let e = error as NSError? else { return false }
    return e.domain == CBErrorDomain && e.code == CBError.Code.peerRemovedPairingInformation.rawValue
  }

  private func handleBondRemoved() {
    guard !bondRemovedReported else { return } // debounce — retries recur
    bondRemovedReported = true
    log("BOND REMOVED (peerRemovedPairingInformation) — user forgot the device")
    onBondRemoved?() // JS flips to the Set-Up state
    Notifier.post(id: PassiveEntryCentral.bondRemovedNotifId,
                  title: "Phone Key",
                  body: "Set up your Phone Key to lock, unlock, and start your car")
  }

  func centralManager(_ c: CBCentralManager, willRestoreState dict: [String: Any]) {
    let restored = dict[CBCentralManagerRestoredStatePeripheralsKey] as? [CBPeripheral] ?? []
    log("willRestoreState: \(restored.count) peripherals bg=\(isBackground)")
    guard let p = restored.first else { return }
    // Foreground restore: DON'T drive it. Release so the JS command path owns the
    // single link (two phone centrals to the car = fatal contention).
    guard isBackground else {
      log("foreground restore — releasing \(p.name ?? "?") to JS")
      c.cancelPeripheralConnection(p)
      peripheral = nil
      return
    }
    // Background: this restored peripheral IS our passive-entry link. Make sure
    // we're armed (the restore callback can beat startIfConfigured), then resume.
    if vin.isEmpty, let saved = UserDefaults.standard.string(forKey: PassiveEntryCentral.vinKey) {
      vin = saved
      targetName = PassiveEntryCentral.vehicleLocalName(saved)
    }
    wantScan = true
    peripheral = p
    p.delegate = self
    log("re-adopted \(p.name ?? "?") state=\(p.state.rawValue)")
    // The live session (sessionKey/counter) does NOT survive relaunch, so a warm
    // connection still needs a fresh handshake before it can answer. Kick GATT
    // rediscovery now; if it dropped, reconnect (or fall through to scan).
    switch p.state {
    case .connected:
      txChar = nil; rxChar = nil; rxBuffer = []; rxExpected = -1
      p.discoverServices([PassiveEntryCentral.serviceUUID])
    case .connecting:
      break // iOS will deliver didConnect
    default:
      c.connect(p, options: nil)
    }
  }

  // MARK: - logging

  private func log(_ line: String) {
    onLog?(line)
    appendNativeFile(line)
  }

  private func appendNativeFile(_ line: String) {
    fileQueue.async {
      let ts = ISO8601DateFormatter().string(from: Date())
      let entry = "[native-passive] \(ts) \(line)\n"
      guard
        let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first,
        let data = entry.data(using: .utf8)
      else { return }
      let url = dir.appendingPathComponent("airgapp-native.log")
      if FileManager.default.fileExists(atPath: url.path), let fh = try? FileHandle(forWritingTo: url) {
        fh.seekToEndOfFile()
        fh.write(data)
        try? fh.close()
      } else {
        try? data.write(to: url)
      }
    }
  }

  private func stateName(_ s: CBManagerState?) -> String {
    switch s {
    case .some(.poweredOn): return "poweredOn"
    case .some(.poweredOff): return "poweredOff"
    case .some(.unauthorized): return "unauthorized"
    case .some(.resetting): return "resetting"
    case .some(.unsupported): return "unsupported"
    case .some(.unknown), .none: return "unknown"
    @unknown default: return "?"
    }
  }
}
