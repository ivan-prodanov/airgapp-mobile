import Foundation
import JavaScriptCore
import Security

// AirgappEngine — runs the app's own Tesla protocol implementation inside the
// Share Extension, in JavaScriptCore.
//
// WHY NOT A SWIFT PORT: the extension needs ECDH → SHA1(shared)[:16], the AES-GCM
// metadata/AAD block, the RoutableMessage envelope, the counter/epoch/clock merge
// and the framing. The AAD construction alone took a full reverse-engineering
// round trip to get right. A second implementation of that, which must agree with
// the first forever or produce silently unauthenticated commands, is the worst
// outcome available. Tesla wrote theirs in Swift because their app is Swift and
// they had no JS engine to share; we are the opposite case.
//
// The engine is `AirgappEngine.js`, built by scripts/build-extension-bundle.mjs
// from src/ble/extensionEntry.ts. That build refuses to ship a bundle that cannot
// load in a bare context, because this process has no console and a missing host
// global would otherwise surface as a share that silently does nothing.
//
// ── Threading ──
//
// A JSContext is NOT thread-safe. Every touch of the context — evaluating the
// bundle, calling into it, and resolving a promise from a transport callback —
// happens on `queue`. Transport implementations may call back from anywhere.

// What the host must be able to do for the engine. Deliberately the same three
// calls the app's transports implement, so the engine cannot tell which one it is
// driving.
public protocol EngineTransport: AnyObject {
  func openSession(vin: String, completion: @escaping (Result<String, Error>) -> Void)
  func exchange(sessionId: String, payloadB64: String, timeoutMs: Int,
                completion: @escaping (Result<String, Error>) -> Void)
  func closeSession(sessionId: String, completion: @escaping () -> Void)
}

public struct EngineSendResult {
  // True ONLY when the car itself confirmed the destination. A transport ACK is
  // not an acceptance.
  public let ok: Bool
  // accepted | refused | failed | unverified — 'unverified' means the send
  // appeared to work but the car returned no verdict we could read, which is NOT
  // a success: an accepted send and a refused one are indistinguishable there.
  public let verdict: String
  public let reason: String?
}

public enum EngineError: Error, LocalizedError {
  case bundleMissing
  case didNotInstall
  case threw(String)

  public var errorDescription: String? {
    switch self {
    case .bundleMissing: return "AirgappEngine.js is not in the extension bundle"
    case .didNotInstall: return "the engine loaded but did not install airgappSendNavigation"
    case .threw(let m): return m
    }
  }
}

public final class AirgappEngine {
  private let queue = DispatchQueue(label: "local.airgapp.engine")
  private let context = JSContext()!
  private let transport: EngineTransport
  private var loaded = false

  public init(transport: EngineTransport) {
    self.transport = transport
  }

  // MARK: - Loading

  private func loadIfNeeded() throws {
    if loaded { return }

    // Surfaced through the trace, not swallowed: an exception while evaluating a
    // 2.4 MB bundle is otherwise completely invisible from here.
    context.exceptionHandler = { _, exception in
      ShareOutboxStore.trace("engine: JS exception — \(exception?.toString() ?? "unknown")")
    }

    guard
      let url = Bundle(for: AirgappEngine.self).url(forResource: "AirgappEngine", withExtension: "js")
        ?? Bundle.main.url(forResource: "AirgappEngine", withExtension: "js"),
      let source = try? String(contentsOf: url, encoding: .utf8)
    else {
      throw EngineError.bundleMissing
    }

    installHostGlobals()
    context.evaluateScript(source)

    guard let fn = context.objectForKeyedSubscript("airgappSendNavigation"), !fn.isUndefined else {
      throw EngineError.didNotInstall
    }
    loaded = true
  }

  // The four symbols the engine needs and cannot provide for itself. Everything
  // else it carries — TextEncoder/TextDecoder are polyfilled inside the bundle
  // precisely so this list stays short: each entry here is one more thing that can
  // be forgotten, mis-implemented, or differ between the app and the extension.
  private func installHostGlobals() {
    // getRandomValues is NOT optional and NOT stubbable: @noble/hashes draws its
    // randomness from it, and a weak implementation is a silent crypto break
    // rather than a crash. SecRandomCopyBytes is the only acceptable source.
    //
    // It must fill and return THE SAME array object, which is why this writes
    // through the JSValue rather than building a new one.
    let getRandomValues: @convention(block) (JSValue) -> JSValue = { array in
      let length = Int(array.forProperty("length")?.toInt32() ?? 0)
      guard length > 0 else { return array }
      var bytes = [UInt8](repeating: 0, count: length)
      guard SecRandomCopyBytes(kSecRandomDefault, length, &bytes) == errSecSuccess else {
        // Refuse rather than fall back to anything weaker. A share that fails is
        // recoverable; a command signed with predictable randomness is not.
        ShareOutboxStore.trace("engine: SecRandomCopyBytes FAILED — refusing to supply randomness")
        return JSValue(undefinedIn: array.context)
      }
      for i in 0..<length { array.setValue(bytes[i], at: i) }
      return array
    }
    let crypto = JSValue(newObjectIn: context)
    crypto?.setObject(getRandomValues, forKeyedSubscript: "getRandomValues" as NSString)
    context.setObject(crypto, forKeyedSubscript: "crypto" as NSString)

    let open: @convention(block) (String) -> JSValue? = { [weak self] vin in
      self?.promise { done in
        self?.transport.openSession(vin: vin) { done($0.map { $0 as Any }) }
      }
    }
    let exchange: @convention(block) (String, String, Int) -> JSValue? = { [weak self] id, payload, timeoutMs in
      self?.promise { done in
        self?.transport.exchange(sessionId: id, payloadB64: payload, timeoutMs: timeoutMs) {
          done($0.map { $0 as Any })
        }
      }
    }
    let close: @convention(block) (String) -> JSValue? = { [weak self] id in
      self?.promise { done in
        self?.transport.closeSession(sessionId: id) { done(.success(true)) }
      }
    }
    context.setObject(open, forKeyedSubscript: "__openSession" as NSString)
    context.setObject(exchange, forKeyedSubscript: "__exchange" as NSString)
    context.setObject(close, forKeyedSubscript: "__closeSession" as NSString)
  }

  // Wraps an async Swift call as a JS promise. The transport may call back on any
  // thread; settling hops onto `queue` because touching the context from two
  // threads is a crash, and an intermittent one.
  private func promise(_ work: @escaping (@escaping (Result<Any, Error>) -> Void) -> Void) -> JSValue? {
    JSValue(newPromiseIn: context) { [weak self] resolve, reject in
      var settled = false
      work { result in
        guard let self = self else { return }
        self.queue.async {
          // A transport that calls back twice must not settle twice — JS ignores
          // it, but the bug stays hidden. Catch it here where it is visible.
          if settled {
            ShareOutboxStore.trace("engine: transport settled twice — ignoring the second")
            return
          }
          settled = true
          switch result {
          case .success(let value): resolve?.call(withArguments: [value])
          case .failure(let error): reject?.call(withArguments: [error.localizedDescription])
          }
        }
      }
    }
  }

  // MARK: - Sending

  // Send one destination. `completion` fires on an arbitrary queue.
  public func sendNavigation(vin: String, lat: Double, lon: Double, label: String?,
                             privateScalarHex: String,
                             completion: @escaping (Result<EngineSendResult, Error>) -> Void) {
    queue.async {
      do {
        try self.loadIfNeeded()
      } catch {
        return completion(.failure(error))
      }

      var args: [String: Any] = ["vin": vin, "lat": lat, "lon": lon, "privateScalarHex": privateScalarHex]
      if let label = label, !label.isEmpty { args["label"] = label }
      guard
        let data = try? JSONSerialization.data(withJSONObject: args),
        let json = String(data: data, encoding: .utf8),
        let fn = self.context.objectForKeyedSubscript("airgappSendNavigation")
      else {
        return completion(.failure(EngineError.threw("could not build the engine's arguments")))
      }

      // JSON in, JSON out. JavaScriptCore's bridging of structured values is
      // fiddly and version-sensitive; a string crosses cleanly in every direction.
      guard let promise = fn.call(withArguments: [json]), !promise.isUndefined else {
        return completion(.failure(EngineError.threw("airgappSendNavigation returned nothing")))
      }

      var finished = false
      let onSettled: (String?, String?) -> Void = { raw, failure in
        self.queue.async {
          if finished { return }
          finished = true
          if let failure = failure { return completion(.failure(EngineError.threw(failure))) }
          guard
            let raw = raw, let data = raw.data(using: .utf8),
            let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
          else {
            return completion(.failure(EngineError.threw("the engine returned an unreadable result")))
          }
          completion(.success(EngineSendResult(
            ok: obj["ok"] as? Bool ?? false,
            verdict: obj["verdict"] as? String ?? "failed",
            reason: obj["reason"] as? String
          )))
        }
      }

      let fulfilled: @convention(block) (JSValue) -> Void = { value in onSettled(value.toString(), nil) }
      let rejected: @convention(block) (JSValue) -> Void = { value in
        // The engine is written never to throw across the bridge, so reaching
        // here means something upstream of its own error handling broke.
        onSettled(nil, "the engine rejected: \(value.toString() ?? "unknown")")
      }
      promise.invokeMethod("then", withArguments: [JSValue(object: fulfilled, in: self.context) as Any])
      promise.invokeMethod("catch", withArguments: [JSValue(object: rejected, in: self.context) as Any])
    }
  }
}
