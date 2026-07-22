import CoreBluetooth
import CryptoKit
import Foundation

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
final class PassiveEntryCentral: NSObject, CBCentralManagerDelegate {
  static let serviceUUID = CBUUID(string: "00000211-b2d1-43f0-9b88-960cebf8b91e")
  static let restoreId = "airgapp.passiveentry"

  private var central: CBCentralManager?
  private var peripheral: CBPeripheral?
  private var targetName: String?
  private var wantScan = false
  private let onLog: (String) -> Void
  private let fileQueue = DispatchQueue(label: "airgapp.passiveentry.filelog")

  init(onLog: @escaping (String) -> Void) {
    self.onLog = onLog
    super.init()
    // Create the manager up front WITH the restore identifier so restoration is
    // armed. (Background relaunch re-creation is wired in a later task.)
    central = CBCentralManager(
      delegate: self,
      queue: nil,
      options: [CBCentralManagerOptionRestoreIdentifierKey: PassiveEntryCentral.restoreId]
    )
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
    targetName = PassiveEntryCentral.vehicleLocalName(vin)
    wantScan = true
    log("start vin=…\(vin.suffix(6)) target=\(targetName ?? "?") state=\(stateName(central?.state))")
    if central?.state == .poweredOn { beginScan() }
  }

  func stop() {
    wantScan = false
    central?.stopScan()
    if let p = peripheral { central?.cancelPeripheralConnection(p) }
    peripheral = nil
    log("stop")
  }

  private func beginScan() {
    guard wantScan else { return }
    // Scan-ALL (withServices: nil) + match by name — the car advertises its
    // local name but NOT the GATT service UUID, so a service filter finds
    // nothing (matches how DirectBleTransport scans: startDeviceScan(null)).
    // NOTE: nil-scan does NOT work in the background (iOS requires a service
    // filter there) — the background path will need the ADVERTISED service UUID,
    // which we log on discovery below to find out what it is.
    log("scanning (all peripherals, match by name)…")
    central?.scanForPeripherals(withServices: nil, options: nil)
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
    log("CONNECTED \(p.name ?? "?") — holding link")
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
    log("willRestoreState: \(restored.count) peripherals")
    if let p = restored.first {
      peripheral = p
      p.delegate = nil
      log("re-adopted \(p.name ?? "?") state=\(p.state.rawValue)")
    }
  }

  // MARK: - logging

  private func log(_ line: String) {
    onLog(line)
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
