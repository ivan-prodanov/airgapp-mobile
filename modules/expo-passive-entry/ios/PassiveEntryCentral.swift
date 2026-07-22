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

  // Singleton: the CBCentralManager (with restore id) must be re-created at APP
  // LAUNCH for iOS state restoration to relaunch us in the background — so the
  // AppDelegate subscriber and the JS module both reach the SAME instance here,
  // not a per-call one.
  static let shared = PassiveEntryCentral()
  private static let vinKey = "airgapp.passiveentry.vin"

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
    log("start vin=…\(vin.suffix(6)) target=\(targetName ?? "?") state=\(stateName(central?.state))")
    if central?.state == .poweredOn { beginScan() }
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

  // The car ADVERTISES the 16-bit service UUID 1122 (confirmed on-car
  // 2026-07-22: `advServices=[1122]`), NOT the full GATT service 00000211. This
  // is the filter to scan on — and crucially it works in the BACKGROUND, where
  // iOS forbids nil-scan. (The GATT service 00000211 is still what we read/write
  // characteristics on once connected; it just isn't in the advert.)
  static let advertisedServiceUUID = CBUUID(string: "1122")

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
    if c.state == .poweredOn { beginScan() }
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
    startHandshake(p)
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
    rxBuffer += [UInt8](data)
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
    // …otherwise a payload(10) carrying an authenticationRequest(3) is a
    // passive-entry CHALLENGE — answer it.
    if let payload = VcsecSigner.extractLenField(frame, 10),
       let authReq = VcsecSigner.extractLenField(payload, 3) {
      answerChallenge(authReq); return
    }
    // else: routine push (vehicleStatus etc.) — ignore.
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
    sessionKey = sk; counter = si.counter; epoch = si.epoch
    clockBase = si.clockTime; handshakeWallSec = UInt32(Date().timeIntervalSince1970)
    myPubRaw = myPub; answersGiven = 0
    log("HANDSHAKE ✓ epoch=\(VcsecSigner.hex(si.epoch).prefix(8)) counter=\(si.counter) clock=\(si.clockTime) hmacOK=\(hmacOK)")
  }

  private func answerChallenge(_ authReq: [UInt8]) {
    guard let sk = sessionKey, let p = peripheral else { return }
    guard answersGiven < maxAnswers else { return }
    // requestedLevel (field 3 of AuthenticationRequest); default DRIVE(2).
    let level = VcsecSigner.extractVarintField(authReq, 3) ?? 2
    counter += 1
    let elapsed = UInt32(Date().timeIntervalSince1970) &- handshakeWallSec
    let expiresAt = clockBase &+ elapsed &+ 5
    // inner = UnsignedMessage{ authenticationResponse{ level, distance=0, rejection=0 } }
    let inner: [UInt8] = [0x1a, 0x06, 0x08, UInt8(truncatingIfNeeded: level), 0x10, 0x00, 0x18, 0x00]
    var nonce = [UInt8](repeating: 0, count: 12); _ = SecRandomCopyBytes(kSecRandomDefault, 12, &nonce)
    guard let r = VcsecSigner.sealFrame(sessionKey: sk, vin: vin, epoch: epoch, counter: counter,
                                        expiresAt: expiresAt, routingAddress: routingAddress, myPubRaw: myPubRaw,
                                        nonce: nonce, flags: 0, uuid: [0x00], inner: inner) else {
      log("challenge seal failed"); return
    }
    answersGiven += 1
    log("auth ANSWERED #\(answersGiven) counter=\(counter) level=\(level) out=\(r.frame.count)B")
    writeFramed(r.frame, to: p)
  }

  func centralManager(_ c: CBCentralManager, didFailToConnect p: CBPeripheral, error: Error?) {
    log("connect FAILED: \(error?.localizedDescription ?? "?") → rescanning")
    beginScan()
  }

  func centralManager(_ c: CBCentralManager, didDisconnectPeripheral p: CBPeripheral, error: Error?) {
    log("disconnected: \(error?.localizedDescription ?? "clean") → rescanning")
    if wantScan { beginScan() }
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
