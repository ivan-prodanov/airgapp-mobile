import UserNotifications

// Notifier — local notifications posted from NATIVE code, so they fire even
// while the JS runtime is suspended (BT toggled off in the background, the app
// terminated, the car's bond removed). expo-notifications is JS-only and can't
// help when Hermes isn't running; UNUserNotificationCenter can.
//
// Authorization is requested once at arm time (foreground), so a later
// background post has permission ready. A denied/undetermined permission just
// means add(...) silently no-ops — a reminder must never nag or crash.
enum Notifier {
  // Ask for alert permission once. Idempotent — iOS only shows the system prompt
  // the first time. Call from the foreground (arming) so a background post later
  // already has the grant.
  static func requestAuthIfNeeded() {
    NotifDelegate.shared.install()
    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
  }

  // Post an immediate local notification. `id` dedupes: re-posting the same id
  // replaces the pending/last one rather than stacking duplicates (e.g. BT
  // toggled off twice).
  static func post(id: String, title: String, body: String) {
    NotifDelegate.shared.install() // ensure foreground banners present
    let content = UNMutableNotificationContent()
    if !title.isEmpty { content.title = title }
    content.body = body
    content.sound = nil
    let req = UNNotificationRequest(identifier: id, content: content, trigger: nil)
    UNUserNotificationCenter.current().add(req, withCompletionHandler: nil)
  }

  // Post and BLOCK until the notification daemon has accepted the request (or a
  // short timeout). add(...) is asynchronous, so during applicationWillTerminate
  // the app can die before the request reaches usernotificationsd — losing the
  // notification. Waiting on the completion handler guarantees the hand-off
  // completes while we still have the ~5s termination window. Safe to block the
  // main thread here: the completion fires on a background queue, so no deadlock.
  static func postAndWait(id: String, title: String, body: String, timeout: TimeInterval = 3.0) {
    NotifDelegate.shared.install()
    let content = UNMutableNotificationContent()
    if !title.isEmpty { content.title = title }
    content.body = body
    content.sound = nil
    let req = UNNotificationRequest(identifier: id, content: content, trigger: nil)
    let sem = DispatchSemaphore(value: 0)
    UNUserNotificationCenter.current().add(req) { _ in sem.signal() }
    _ = sem.wait(timeout: .now() + timeout)
  }

  // Withdraw a previously-posted notification by id (e.g. clear the "Bluetooth
  // Disabled" reminder once BT comes back on).
  static func clear(id: String) {
    let center = UNUserNotificationCenter.current()
    center.removePendingNotificationRequests(withIdentifiers: [id])
    center.removeDeliveredNotifications(withIdentifiers: [id])
  }
}

// NotifDelegate — makes our reminders present while the app is in the FOREGROUND.
//
// iOS suppresses a notification banner for the active app UNLESS a
// UNUserNotificationCenterDelegate returns presentation options from
// willPresent. expo-notifications installs its own delegate (routing to the JS
// setNotificationHandler) at launch; when it's active our native-posted
// reminders present fine backgrounded but are swallowed foreground. We chain in
// front of it: install() right before each post (idempotent, self-healing if
// expo ever re-claims the delegate), always show the banner (every reminder here
// is worth showing), and forward taps to the previous delegate so expo's
// response handling still works.
final class NotifDelegate: NSObject, UNUserNotificationCenterDelegate {
  static let shared = NotifDelegate()
  private weak var previous: UNUserNotificationCenterDelegate?

  func install() {
    let center = UNUserNotificationCenter.current()
    if center.delegate === self { return }
    previous = center.delegate
    center.delegate = self
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    willPresent notification: UNNotification,
    withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
  ) {
    completionHandler([.banner, .list, .sound])
  }

  func userNotificationCenter(
    _ center: UNUserNotificationCenter,
    didReceive response: UNNotificationResponse,
    withCompletionHandler completionHandler: @escaping () -> Void
  ) {
    if let prev = previous,
       prev.responds(to: #selector(UNUserNotificationCenterDelegate.userNotificationCenter(_:didReceive:withCompletionHandler:))) {
      prev.userNotificationCenter?(center, didReceive: response, withCompletionHandler: completionHandler)
    } else {
      completionHandler()
    }
  }
}
