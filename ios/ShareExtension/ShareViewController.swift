import UIKit
import UniformTypeIdentifiers
import MapKit

// Share extension: resolve the shared place, queue it into the App Group as `{raw, ts, location?}`, nudge the app
// awake and dismiss. Sharing into airgapp IS the decision — the app sends the place to the car the moment it drains
// the intent — so there is nothing here to preview, reorder or choose. The spinner is not decoration: resolving a
// Google short link is a network round-trip that can take seconds, and the sheet would otherwise look frozen.
class ShareViewController: UIViewController {
  private let suite = "group.local.airgapp.mobile"
  private let mapItemType = "com.apple.mapkit.map-item"
  private let spinner = UIActivityIndicatorView(style: .large)
  private let statusLabel = UILabel()
  private let detailLabel = UILabel()
  private let stageLabel = UILabel()
  private var resolved: ResolvedLocation?
  private var rawShare: String = ""
  private var completed = false

  override func viewDidLoad() {
    super.viewDidLoad()
    ShareTrace.trace("extension launched")
    installLoadingUI()
    if let sheet = sheetPresentationController {
      sheet.detents = [.large()]           // fixed size — the sheet is not user-resizable
      sheet.prefersGrabberVisible = false  // no grabber affordance
    }
    loadAndResolve()
  }

  private func installLoadingUI() {
    view.backgroundColor = .systemBackground
    statusLabel.text = "Sharing to car"
    statusLabel.font = .systemFont(ofSize: 17, weight: .medium)
    statusLabel.textColor = .label
    statusLabel.textAlignment = .center
    detailLabel.font = .systemFont(ofSize: 14)
    detailLabel.textColor = .secondaryLabel
    detailLabel.textAlignment = .center
    detailLabel.numberOfLines = 2
    detailLabel.isHidden = true
    // The live commentary. Without it this sheet is a spinner on white for up to
    // twelve seconds while it tries one radio and then another, and there is no
    // way to tell "working on it" from "hung".
    stageLabel.font = .systemFont(ofSize: 13)
    stageLabel.textColor = .tertiaryLabel
    stageLabel.textAlignment = .center
    stageLabel.numberOfLines = 1
    stageLabel.text = "Finding the location…"
    let stack = UIStackView(arrangedSubviews: [spinner, statusLabel, detailLabel, stageLabel])
    stack.axis = .vertical
    stack.spacing = 10
    stack.alignment = .center
    stack.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(stack)
    NSLayoutConstraint.activate([
      stack.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      stack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
    ])
    spinner.startAnimating()
  }

  // On iOS 26 the map-item attachment arrives as an NSKeyedArchiver blob (Data), not a live MKMapItem — so
  // `data as? MKMapItem` fails. Unarchive it; non-secure because the graph nests MKPlacemark/CLPlacemark.
  private static func decodeMapItem(_ data: Any?) -> MKMapItem? {
    if let mi = data as? MKMapItem { return mi }
    guard let d = data as? Data, let un = try? NSKeyedUnarchiver(forReadingFrom: d) else { return nil }
    un.requiresSecureCoding = false
    return un.decodeObject(forKey: NSKeyedArchiveRootObjectKey) as? MKMapItem
  }

  private func loadAndResolve() {
    guard let providers = (extensionContext?.inputItems as? [NSExtensionItem])?.flatMap({ $0.attachments ?? [] }),
          !providers.isEmpty else { return finish(nil) }

    if let p = providers.first(where: { $0.hasItemConformingToTypeIdentifier(mapItemType) }) {
      p.loadItem(forTypeIdentifier: mapItemType, options: nil) { [weak self] data, _ in
        guard let self = self else { return }
        if let mapItem = Self.decodeMapItem(data) {
          let c = mapItem.placemark.coordinate
          self.rawShare = "https://maps.apple.com/?ll=\(c.latitude),\(c.longitude)&q=\((mapItem.name ?? "").addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")"
          SharedLocationResolver.resolve(mapItem: mapItem) { self.finish($0) }
        } else { self.finish(nil) }
      }
    } else if let p = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.url.identifier) }) {
      p.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { [weak self] data, _ in
        self?.resolveRaw((data as? URL)?.absoluteString ?? (data as? String))
      }
    } else if let p = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) }) {
      p.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { [weak self] data, _ in
        self?.resolveRaw(data as? String)
      }
    } else { finish(nil) }
  }

  private func resolveRaw(_ raw: String?) {
    guard let raw = raw, !raw.isEmpty else { return finish(nil) }
    rawShare = raw
    SharedLocationResolver.resolve(raw: raw) { [weak self] in self?.finish($0) }
  }

  // The end of the road for every path above: queue the intent, nudge the app, dismiss. Guarded so a resolver that
  // fires twice cannot overwrite an already-written intent with a null one.
  private func finish(_ loc: ResolvedLocation?) {
    DispatchQueue.main.async {
      guard !self.completed else { return }
      self.resolved = loc
      if let r = loc {
        // Name the place the moment we know it: the most reassuring thing this
        // sheet can show is that it read the right location.
        self.detailLabel.text = r.name ?? r.address ?? String(format: "%.4f, %.4f", r.latitude, r.longitude)
        self.detailLabel.isHidden = false
      }
      guard let r = loc else {
        ShareTrace.trace("resolved=nil — nothing to send")
        return self.showTerminal("Error", "Couldn't read that location")
      }
      self.sendToCar(r)
    }
  }

  // Send from THE EXTENSION, behind the spinner, with a bounded deadline.
  //
  // Four terminal states, matching what the vendor's own extension does: Sending
  // → Sent / Error / Timed out. A slow send is a spinner, not a failure — Tesla
  // budgets for that and so do we, because opening a cold BLE session is
  // legitimately seconds of work.
  //
  // The outbox is now only the LAST resort: it exists so that a send with no
  // working transport is not simply thrown away. It is not the delivery path.
  private func sendToCar(_ r: ResolvedLocation) {
    guard let keyHex = SharedSecrets.deviceKeyHex(), let car = SharedSecrets.carConfig() else {
      ShareTrace.trace("send: no device key or VIN in the shared keychain")
      return showTerminal("Error", "Open airgapp once to finish setup")
    }

    let presence = CarPresence.read()
    // Stale or absent presence reads as IN RANGE — see CarPresence. Being wrong
    // that way costs a Pi attempt; being wrong the other way takes the BLE radio
    // while standing next to the car.
    let pi = SharedSecrets.piConfig().map { cfg in
      // 22s: a cold Pi-side scan legitimately takes 8-15s.
      TransportArbiter.Arm(name: "pi", capMs: 22_000) {
        (AirgappEngine(transport: PiTransport(config: cfg)), "host")
      }
    }
    // BLE reaches the car with no network at all — a garage or underground car
    // park, where the Pi is unreachable and this is the only way through.
    // 10s: BLE reaches a car that is nearby in about a second (measured), and a
    // car that is not there is decided in 3 by the discovery timeout. Anything
    // beyond this is time the Pi arm needs.
    let ble = TransportArbiter.Arm(name: "ble", capMs: 10_000) {
      let pipe = BleBytePipe()
      // The engine drives the JS-side transport; this EngineTransport is never
      // called on the BLE arm, so it is a stub rather than a real path.
      return (AirgappEngine(transport: UnusedTransport(), blePipe: pipe), "ble")
    }
    let arms = TransportArbiter.order(inRange: presence.treatAsInRange, pi: pi, ble: ble)
    ShareTrace.trace("send: presence linkUp=\(presence.linkUp) stale=\(presence.stale) bleFirst=\(TransportArbiter.forceBleFirst) → arms=[\(arms.map { $0.name }.joined(separator: ","))]")

    let label = r.name ?? r.address
    let arbiter = TransportArbiter(arms: arms)
    self.setStage(arms.first.map { Self.stageText(for: $0.name) } ?? "Connecting…")

    // Bounded: the share sheet must not hang forever if a transport stalls.
    var settled = false
    let deadline = DispatchWorkItem { [weak self] in
      guard !settled else { return }
      settled = true
      // Name the arm that was still running: "timed out" on its own cannot tell
      // a car that is not there from a Pi that is not answering.
      let stalled = self?.stageLabel.text ?? ""
      ShareTrace.trace("send: TIMED OUT after \(Int(Self.sendDeadline))s during \(stalled)")
      self?.showTerminal("Timed out", "Try sharing again")
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.sendDeadline, execute: deadline)

    arbiter.send(
      vin: car.vin, lat: r.latitude, lon: r.longitude, label: label, privateScalarHex: keyHex,
      totalBudgetMs: Int(Self.sendDeadline * 1000),
      onArm: { [weak self] name in
        DispatchQueue.main.async { self?.setStage(Self.stageText(for: name)) }
      }
    ) { result, attempts in
      DispatchQueue.main.async {
        guard !settled else { return }
        settled = true
        deadline.cancel()
        let tried = attempts.map { $0.arm }.joined(separator: ",")
        switch result {
        case .success(let sent) where sent.verdict == "accepted":
          ShareTrace.trace("send: ACCEPTED via [\(tried)]")
          self.showTerminal("Sent", label.map { "Shared \($0)" } ?? "Shared with your car")
        case .success(let sent) where sent.verdict == "refused":
          // The car answered on the destination's merits. Queueing would just
          // re-ask a question that has been answered.
          ShareTrace.trace("send: REFUSED — \(sent.reason ?? "no reason")")
          self.showTerminal("Error", sent.reason ?? "Your car wouldn't accept that place")
        case .success(let sent):
          // Every arm ran and none produced a verdict we could read. Reporting
          // failure is the honest answer: the send MAY have landed, and silently
          // re-sending it later is what made a place arrive after the user had
          // already moved on.
          ShareTrace.trace("send: \(sent.verdict) via [\(tried)]")
          self.showTerminal("Error", "Couldn't confirm — try again")
        case .failure(let error):
          ShareTrace.trace("send: FAILED via [\(tried)] — \(error.localizedDescription)")
          self.showTerminal("Error", "Couldn't reach your car — try again")
        }
      }
    }
  }

  // The whole-sheet budget. It must EXCEED the sum of the arms it will walk, or
  // the later arms are decorative: at 25s, with BLE burning 12s and the Pi asking
  // for 45s, a share out of BLE range could only ever end in a timeout — the Pi
  // was never given long enough to answer. 6s (BLE) + 20s (Pi) = 26s, so 30s
  // leaves margin for resolution and the handshake.
  // The whole-sheet budget, and the ONE authority: the arbiter divides it between
  // arms (10s BLE + 22s Pi = 32s of caps) and hands each engine its slice, so no
  // layer sets its own timeout any more. It must exceed the caps it will actually
  // walk, or the last arm is decorative — which is what 25s did when the engine's
  // own 25s-per-command default meant two arms could want 50s between them.
  private static let sendDeadline: TimeInterval = 35

  // Plain words for each arm. "Pi" is what Ivan calls the box; "Bluetooth" is
  // what the phone calls the radio. Neither is jargon to the person reading it.
  private static func stageText(for arm: String) -> String {
    switch arm {
    case "ble": return "Trying Bluetooth…"
    case "pi": return "Trying your Pi…"
    default: return "Sending…"
    }
  }

  private func setStage(_ text: String) {
    stageLabel.text = text
    stageLabel.isHidden = false
  }

  // Show the outcome briefly, then dismiss. The user gets a verdict rather than a
  // sheet that vanishes and leaves them guessing whether it worked.
  private func showTerminal(_ title: String, _ detail: String) {
    spinner.stopAnimating()
    statusLabel.text = title
    // The place stays in detailLabel — on success it is the confirmation, and on
    // failure it is what you would be retrying — so the reason goes below it.
    if detailLabel.isHidden {
      detailLabel.text = detail
      detailLabel.isHidden = false
      stageLabel.isHidden = true
    } else {
      stageLabel.text = detail
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.6) { [weak self] in self?.finishRequest() }
  }

  private func finishRequest() {
    guard !completed else { return }
    completed = true
    extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
  }
}
