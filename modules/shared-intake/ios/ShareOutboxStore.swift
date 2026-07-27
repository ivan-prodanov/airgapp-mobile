import Foundation

// ShareOutboxStore — the App Group file holding places shared into the app but
// not yet accepted by the car.
//
// Compiled into BOTH the Share Extension and the app's native module (by path
// reference, the same way SharedLocationExtract.swift is shared), because both
// processes touch this file: the extension appends on share, the app drains.
//
// ── Why a file and not UserDefaults ──
//
// UserDefaults has no atomic read-modify-write across processes. Append is
// exactly read-modify-write, and two processes doing it unsynchronised lose
// writes — which is the bug this whole queue exists to fix, so implementing it on
// a primitive that has the same flaw would be circular. NSFileCoordinator gives
// the cross-process serialisation UserDefaults cannot.
//
// ── The one invariant ──
//
//   APPEND BEFORE ATTEMPTING. REMOVE ONLY ON A CAR-CONFIRMED ACCEPT.
//
// The extension's job is the first half: get the place into this file BEFORE it
// tries anything that can fail. Everything after that is the app's problem, and a
// place that reached this file is never lost by a failed send.
//
// The item shape is defined once, in TypeScript (src/state/shareOutbox.ts), and
// this side deliberately does NOT model it. Swift reads and writes an opaque JSON
// array and only ever appends whole objects — so the two sides cannot drift, and
// adding a field never requires touching this file.
public enum ShareOutboxStore {
  public static let appGroup = "group.local.airgapp.mobile"
  public static let fileName = "share-outbox.json"

  private static var url: URL? {
    FileManager.default
      .containerURL(forSecurityApplicationGroupIdentifier: appGroup)?
      .appendingPathComponent(fileName)
  }

  // readRaw returns the file's contents, or "[]" when there is nothing yet.
  //
  // Never throws and never returns nil for a missing or unreadable file: the
  // caller's only sane response would be to treat it as empty anyway, and a throw
  // here would strand a share the caller is about to append.
  public static func readRaw() -> String {
    guard let url = url else { return "[]" }
    var result = "[]"
    var coordinatorError: NSError?
    NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &coordinatorError) { readURL in
      if let data = try? Data(contentsOf: readURL), let text = String(data: data, encoding: .utf8), !text.isEmpty {
        result = text
      }
    }
    return result
  }

  // writeRaw replaces the file's contents. Returns false if the write did not
  // happen, so a caller that must not lose data can react rather than assume.
  @discardableResult
  public static func writeRaw(_ json: String) -> Bool {
    guard let url = url, let data = json.data(using: .utf8) else { return false }
    var ok = false
    var coordinatorError: NSError?
    NSFileCoordinator().coordinate(writingItemAt: url, options: .forReplacing, error: &coordinatorError) { writeURL in
      ok = (try? data.write(to: writeURL, options: .atomic)) != nil
    }
    return ok && coordinatorError == nil
  }

  // append adds one item, read-modify-write, inside a SINGLE coordinated write so
  // a concurrent append from the other process cannot interleave and lose one.
  //
  // `itemJSON` is a complete JSON object for one item, built by the caller. This
  // side never inspects it beyond checking it parses — see the note above on why
  // the shape lives in TypeScript only.
  //
  // Deduplicates on `id` so a retried write cannot queue the same share twice.
  @discardableResult
  public static func append(itemJSON: String) -> Bool {
    guard let url = url else { return false }
    guard
      let itemData = itemJSON.data(using: .utf8),
      let item = (try? JSONSerialization.jsonObject(with: itemData)) as? [String: Any]
    else { return false }

    var ok = false
    var coordinatorError: NSError?
    // Read and write inside ONE coordination block. Doing readRaw() then
    // writeRaw() would open a window for the other process to append between
    // them, and its item would be silently overwritten — precisely the loss this
    // queue replaces.
    NSFileCoordinator().coordinate(
      writingItemAt: url, options: [], error: &coordinatorError
    ) { fileURL in
      var items: [[String: Any]] = []
      if let data = try? Data(contentsOf: fileURL),
         let parsed = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] {
        items = parsed
      }
      if let id = item["id"] as? String {
        items.removeAll { ($0["id"] as? String) == id }
      }
      items.append(item)
      if let out = try? JSONSerialization.data(withJSONObject: items, options: []) {
        ok = (try? out.write(to: fileURL, options: .atomic)) != nil
      }
    }
    return ok && coordinatorError == nil
  }
}
