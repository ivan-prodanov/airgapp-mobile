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
    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
  }

  // Post an immediate local notification. `id` dedupes: re-posting the same id
  // replaces the pending/last one rather than stacking duplicates (e.g. BT
  // toggled off twice).
  static func post(id: String, title: String, body: String) {
    let content = UNMutableNotificationContent()
    if !title.isEmpty { content.title = title }
    content.body = body
    content.sound = nil
    let req = UNNotificationRequest(identifier: id, content: content, trigger: nil)
    UNUserNotificationCenter.current().add(req, withCompletionHandler: nil)
  }

  // Withdraw a previously-posted notification by id (e.g. clear the "Bluetooth
  // Disabled" reminder once BT comes back on).
  static func clear(id: String) {
    let center = UNUserNotificationCenter.current()
    center.removePendingNotificationRequests(withIdentifiers: [id])
    center.removeDeliveredNotifications(withIdentifiers: [id])
  }
}
