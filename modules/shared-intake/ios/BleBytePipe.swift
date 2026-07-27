import Foundation
import CoreBluetooth
import CryptoKit

// BleBytePipe — the Share Extension's own BLE central, kept deliberately DUMB.
//
// It scans for the car, connects, subscribes, writes the chunks it is handed, and
// forwards every raw notification back. It does not frame, reassemble, correlate,
// or parse a single byte.
//
// That is not laziness, it is the same decision as the JSC engine. Framing and
// request/response correlation live in src/ble/bleCorrelation.ts, a port of
// tesla_session.go hardened by the BLE-wedge fix — correlation decides on the
// frame's own request_uuid because the routing address demonstrably lost
// challenges under load. Reimplementing that here would be the second protocol
// implementation, and its failure mode is not a crash: it is silently returning
// another message as the answer to your command.
//
// ── On running a second central ──
//
// The app may be holding a link to the same car. That is FINE and is not the
// two-manager hazard from this project's history: there is one LE ACL link per
// central/peripheral pair and bluetoothd owns it, so both CBCentralManagers are
// façades over the same connection. The hazard was two managers in ONE process.
// Tesla's own extension ships a BLE arm with no cross-process mutex.
//
// The extension also inherits the container app's Bluetooth grant, so there is no
// usage-description key here and no permission prompt (measured from Tesla's
// appex, which has no NSBluetoothAlwaysUsageDescription while its app does).
public final class BleBytePipe: NSObject {
  public static let serviceUUID = CBUUID(string: "00000211-b2d1-43f0-9b88-960cebf8b91e")
  public static let txUUID = CBUUID(string: "00000212-b2d1-43f0-9b88-960cebf8b91e") // write
  public static let rxUUID = CBUUID(string: "00000213-b2d1-43f0-9b88-960cebf8b91e") // notify

  // "S" + hex(SHA1(utf8(vin))[0:8]) + "C". Must stay byte-identical to
  // src/ble/bleScanName.ts and PassiveEntryCentral.vehicleLocalName — three
  // copies of one derivation, which is why this comment names the other two.
  public static func vehicleLocalName(_ vin: String) -> String {
    let digest = Insecure.SHA1.hash(data: Data(vin.utf8))
    return "S" + digest.prefix(8).map { String(format: "%02x", $0) }.joined() + "C"
  }

  private var central: CBCentralManager?
  private var peripheral: CBPeripheral?
  private var txChar: CBCharacteristic?
  private var rxChar: CBCharacteristic?
  private var targetName = ""
  private var blockLength = 20

  private var connectCompletion: ((Result<Int, Error>) -> Void)?
  private var connectDeadline: DispatchWorkItem?
  private let queue = DispatchQueue(label: "local.airgapp.ext.ble")

  // Raw notifications go here, untouched.
  public var onFrame: ((Data) -> Void)?

  public enum PipeError: Error, LocalizedError {
    case poweredOff
    case unauthorized
    case notFound(String)
    case notReady

    public var errorDescription: String? {
      switch self {
      case .poweredOff: return "Bluetooth is off"
      case .unauthorized: return "this app is not allowed to use Bluetooth"
      case .notFound(let name): return "couldn't find the car nearby (\(name))"
      case .notReady: return "the BLE link is not ready"
      }
    }
  }

  public override init() { super.init() }

  public func connect(vin: String, timeoutMs: Int, completion: @escaping (Result<Int, Error>) -> Void) {
    queue.async {
      self.targetName = BleBytePipe.vehicleLocalName(vin)
      self.connectCompletion = completion

      // Bounded: out of range this simply never finds anything, and the share
      // sheet is waiting on us. The arbiter has another arm.
      let deadline = DispatchWorkItem { [weak self] in
        guard let self = self else { return }
        self.central?.stopScan()
        self.settle(.failure(PipeError.notFound(self.targetName)))
      }
      self.connectDeadline = deadline
      self.queue.asyncAfter(deadline: .now() + .milliseconds(max(0, timeoutMs)), execute: deadline)

      // Created here rather than at init so the radio is not touched until a
      // share actually needs it. centralManagerDidUpdateState starts the scan.
      self.central = CBCentralManager(delegate: self, queue: self.queue)
    }
  }

  public func write(_ chunk: Data) {
    queue.async {
      guard let p = self.peripheral, let tx = self.txChar else { return }
      // .withResponse throughout, matching the app's central: the car's GATT
      // server is the flow-control authority and unacknowledged writes overrun it.
      p.writeValue(chunk, for: tx, type: .withResponse)
    }
  }

  public func disconnect() {
    queue.async {
      self.central?.stopScan()
      if let p = self.peripheral { self.central?.cancelPeripheralConnection(p) }
      self.peripheral = nil
      self.txChar = nil
      self.rxChar = nil
      self.central = nil
    }
  }

  private func settle(_ result: Result<Int, Error>) {
    connectDeadline?.cancel()
    connectDeadline = nil
    guard let completion = connectCompletion else { return }
    connectCompletion = nil
    completion(result)
  }
}

extension BleBytePipe: CBCentralManagerDelegate {
  public func centralManagerDidUpdateState(_ central: CBCentralManager) {
    switch central.state {
    case .poweredOn:
      central.scanForPeripherals(withServices: nil, options: nil)
    case .unauthorized:
      settle(.failure(PipeError.unauthorized))
    case .poweredOff:
      settle(.failure(PipeError.poweredOff))
    default:
      break // .resetting/.unknown resolve into another callback, or the deadline fires
    }
  }

  public func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
                      advertisementData: [String: Any], rssi RSSI: NSNumber) {
    // Match on the VIN-derived local name. Scanning without a service filter is
    // required because the car does not advertise its GATT service UUID.
    let name = (advertisementData[CBAdvertisementDataLocalNameKey] as? String) ?? peripheral.name ?? ""
    guard name == targetName else { return }
    central.stopScan()
    self.peripheral = peripheral
    peripheral.delegate = self
    central.connect(peripheral, options: nil)
  }

  public func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    peripheral.discoverServices([BleBytePipe.serviceUUID])
  }

  public func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
    settle(.failure(error ?? PipeError.notReady))
  }

  public func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
    // Only meaningful if we were still waiting to come up; an exchange in flight
    // surfaces as its own timeout in TS.
    settle(.failure(error ?? PipeError.notReady))
  }
}

extension BleBytePipe: CBPeripheralDelegate {
  public func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    guard let service = peripheral.services?.first(where: { $0.uuid == BleBytePipe.serviceUUID }) else {
      return settle(.failure(PipeError.notReady))
    }
    peripheral.discoverCharacteristics([BleBytePipe.txUUID, BleBytePipe.rxUUID], for: service)
  }

  public func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
    txChar = service.characteristics?.first { $0.uuid == BleBytePipe.txUUID }
    rxChar = service.characteristics?.first { $0.uuid == BleBytePipe.rxUUID }
    guard let rx = rxChar, txChar != nil else { return settle(.failure(PipeError.notReady)) }
    blockLength = max(20, peripheral.maximumWriteValueLength(for: .withResponse))
    peripheral.setNotifyValue(true, for: rx)
  }

  public func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic,
                  error: Error?) {
    // The link is only usable once notifications are actually on — settling at
    // didConnect would let a write go out with nothing listening for the reply.
    guard characteristic.uuid == BleBytePipe.rxUUID else { return }
    if let error = error { return settle(.failure(error)) }
    settle(.success(blockLength))
  }

  public func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
    guard characteristic.uuid == BleBytePipe.rxUUID, let data = characteristic.value else { return }
    // Verbatim, including unsolicited pushes. TS decides what any of it means.
    onFrame?(data)
  }
}
