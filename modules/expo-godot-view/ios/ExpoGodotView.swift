import ExpoModulesCore

/// The single Godot render surface, exposed to React Native as `<ExpoGodotView sceneName=... />`.
///
/// Compiled two ways:
/// - **Simulator** (`targetEnvironment(simulator)`): a gray placeholder. The 2020 Godot 3.2 iOS
///   static lib ships no `arm64-iphonesimulator` slice, so the engine can't run here. The stub
///   keeps simulator builds green for RN/UI work and synthesizes a `GODOT_READY` so the JS bridge
///   flips to "ready".
/// - **Device**: the real Godot surface (engine embed is the remaining Phase 2 work — see
///   `GODOT_INTEGRATION.md`).
final class ExpoGodotView: ExpoView {
  /// Scene to display in the single shared Godot instance (e.g. "mobile").
  var sceneName: String? {
    didSet { didSetSceneName() }
  }

  #if targetEnvironment(simulator)

  // MARK: - Simulator stub

  private let label = UILabel()
  private var didAnnounceReady = false

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    backgroundColor = UIColor(white: 0.5, alpha: 1.0) // gray placeholder
    label.textColor = .white
    label.textAlignment = .center
    label.numberOfLines = 0
    label.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    addSubview(label)
    refreshLabel()
  }

  private func didSetSceneName() {
    refreshLabel()
  }

  private func refreshLabel() {
    label.text = "Godot view — simulator stub\nscene: \(sceneName ?? "—")"
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    guard window != nil, !didAnnounceReady else { return }
    didAnnounceReady = true
    // Simulator-only convenience: there is no engine to emit GODOT_READY, so synthesize it
    // once the view is on screen. Real GODOT_READY comes from GDScript (MobileComm) on device.
    GodotBridge.shared.sendMessage(#"{"type":"GODOT_READY","data":{}}"#)
  }

  #else

  // MARK: - Device (real Godot)

  private var godotHost: GodotHost?
  private var didBoot = false

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    backgroundColor = .black
  }

  // Boot once we have a real (non-zero) size so the engine gets valid dimensions.
  override func layoutSubviews() {
    super.layoutSubviews()
    guard !didBoot, window != nil, bounds.width > 0, bounds.height > 0 else { return }
    didBoot = true

    guard let pck = Bundle.main.path(forResource: "airgapp", ofType: "pck") else {
      NSLog("[ExpoGodotView] airgapp.pck not found in app bundle")
      return
    }
    godotHost = GodotHost(parentView: self, pckPath: pck)
  }

  private func didSetSceneName() {
    // TODO(phase2-device): switch the active Godot scene once the IOSGodotInterface bridge lands.
  }

  #endif
}
