import Foundation

// ShareTrace — the Share Extension's record of what it did, in the App Group.
//
// The extension is a separate process with no console. Without this, a share that
// went wrong left no evidence anywhere and "it didn't work" was indistinguishable
// from "the extension never launched". It found the setTimeout bug in one line.
//
// It also owns `appGroup`, because this is the file both processes already agree
// on and a second copy of that identifier is a second thing that can drift.
//
// WAS ShareTrace, and held a durable send queue. The queue is gone — the
// extension sends for itself now, and a failed send is a failure you retry rather
// than something delivered later, unprompted, after you have moved on. Its
// read/write/append went with it rather than staying as three public functions
// nothing called.

public enum ShareTrace {
  public static let appGroup = "group.local.airgapp.mobile"
  public static let traceFileName = "share-trace.log"

  // trace records what the Share Extension did, because the extension has no
  // console and a share that writes nothing otherwise leaves no evidence at all —
  // "I shared it and nothing happened" was indistinguishable from the extension
  // never launching. Best-effort and UNCO-ORDINATED on purpose: this is a
  // diagnostic, and it must never be the reason a share fails or blocks.
  //
  // Bounded, since it is append-only and nothing prunes it: an unbounded log in a
  // shared container is a disk leak that outlives the bug it was added for.
  public static func trace(_ line: String) {
    guard let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) else { return }
    let traceURL = dir.appendingPathComponent(traceFileName)
    let stamp = ISO8601DateFormatter().string(from: Date())
    guard let data = "\(stamp) \(line)\n".data(using: .utf8) else { return }
    if let handle = try? FileHandle(forWritingTo: traceURL) {
      defer { try? handle.close() }
      if (try? handle.seekToEnd()) != nil, (try? handle.write(contentsOf: data)) != nil {
        if let size = try? handle.offset(), size > 64_000 {
          // Keep the tail; the newest lines are the ones being read.
          if let all = try? String(contentsOf: traceURL, encoding: .utf8) {
            try? String(all.suffix(20_000)).write(to: traceURL, atomically: true, encoding: .utf8)
          }
        }
      }
    } else {
      try? data.write(to: traceURL)
    }
  }

  public static func readTrace() -> String {
    guard let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) else {
      return "(no App Group container — entitlement missing in this process)"
    }
    let traceURL = dir.appendingPathComponent(traceFileName)
    // The resolved container path is part of the answer: if the extension and the
    // app ever disagree about where the group lives, every other symptom here is
    // explained by that one line.
    let head = "container: \(dir.path)\n"
    return head + ((try? String(contentsOf: traceURL, encoding: .utf8)) ?? "(no trace file — the extension has not run since this was added)")
  }



}
