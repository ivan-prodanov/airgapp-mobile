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
    // Make sure notification permission is in hand well before a terminate/BT-off
    // reminder needs it (idempotent — iOS prompts only once).
    Notifier.requestAuthIfNeeded()
    PassiveEntryCentral.shared.startIfConfigured()
    return true
  }

  // The app is terminating — remind the user that passive entry needs the app
  // running. iOS delivers this on a foreground quit and on a swipe-kill of an
  // app that is actively running in the background (our bluetooth-central case),
  // though NOT reliably for a long-suspended app the user swipes away — that's an
  // OS limitation no app can beat. Only nag if passive entry was armed.
  public func applicationWillTerminate(_ application: UIApplication) {
    guard PassiveEntryCentral.isArmed() else { return }
    // postAndWait — block until the daemon accepts it, or the app dies first and
    // the notification is lost (the this-morning symptom).
    Notifier.postAndWait(id: PassiveEntryCentral.appClosedNotifId,
                         title: "", // empty → iOS shows the app name as the header
                         body: "Keep the Tesla app running for the best Phone Key and Live Activity experience")
  }
}
