import ExpoModulesCore
import UIKit

// PassiveEntryAppDelegate — the launch-time hook that makes BACKGROUND passive
// entry possible.
//
// iOS relaunches a suspended (or terminated) app for CoreBluetooth state
// restoration by calling application:didFinishLaunchingWithOptions: with the
// bluetooth-central launch key — and the RN bridge / Hermes may never start on
// that path. So we cannot rely on the JS module being created. This subscriber
// runs inside the real AppDelegate's launch and:
//   1. touches PassiveEntryCentral.shared, which constructs the CBCentralManager
//      WITH the restore identifier — the prerequisite for iOS to then deliver
//      centralManager(_:willRestoreState:) and hand back the restored peripheral;
//   2. calls startIfConfigured(), which resumes scanning/holding from the VIN
//      persisted at enrollment — no JS, phone in pocket.
// If passive entry was never armed, startIfConfigured() is a no-op (idle).
public class PassiveEntryAppDelegate: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    // Only build the central once passive entry has been armed — creating a
    // CBCentralManager triggers the Bluetooth prompt, and restoration only has
    // anything to restore post-enrollment anyway. isArmed() reads persistence
    // without instantiating anything.
    guard PassiveEntryCentral.isArmed() else { return true }
    PassiveEntryCentral.shared.startIfConfigured()
    return true
  }
}
