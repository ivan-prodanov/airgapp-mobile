import Foundation

// PiTransport — the Pi byte-forwarder, for the Share Extension.
//
// A deliberate re-implementation of src/ble/transport.ts and nothing more: the Pi
// is a dumb opaque-byte forwarder, so this moves base64 strings and never looks
// inside them. Every piece of Tesla crypto stays in the engine, which is why this
// file can be this short and why there is no second protocol implementation to
// keep in sync.
//
// The endpoints, payload keys and timeouts below all mirror transport.ts exactly.
// They are a contract with the Pi, not preferences.
public final class PiTransport: EngineTransport {
  // Opening a session is a real Pi-side scan+connect and can legitimately take
  // 8-15s on a cold radio. The caller is responsible for the overall deadline —
  // Tesla's extension shows a spinner and a bounded timeout rather than failing
  // fast, and a slow send is a spinner, not an error.
  private static let openTimeout: TimeInterval = 45
  private static let exchangeBuffer: TimeInterval = 5
  private static let defaultTimeout: TimeInterval = 15

  private static let apiPrefix = "/api/ble"

  private let baseUrl: String
  private let token: String
  private let session: URLSession

  public init(config: SharedSecrets.PiConfig) {
    // Trailing slash trimmed to match joinUrl() in transport.ts. Note the stored
    // baseUrl already ends in /api/ble and this adds the prefix again — the
    // doubled path is what the Pi actually serves, and "fixing" it here would
    // break the working configuration.
    self.baseUrl = config.baseUrl.hasSuffix("/") ? String(config.baseUrl.dropLast()) : config.baseUrl
    self.token = config.token
    let cfg = URLSessionConfiguration.ephemeral
    cfg.waitsForConnectivity = false
    self.session = URLSession(configuration: cfg)
  }

  // MARK: - EngineTransport

  public func openSession(vin: String, completion: @escaping (Result<String, Error>) -> Void) {
    request("POST", "\(Self.apiPrefix)/sessions", body: ["vin": vin], timeout: Self.openTimeout) { result in
      completion(result.flatMap { json in
        guard let id = json?["session_id"] as? String, !id.isEmpty else {
          return .failure(TransportError.malformed("the Pi returned no session_id"))
        }
        return .success(id)
      })
    }
  }

  public func exchange(sessionId: String, payloadB64: String, timeoutMs: Int,
                       completion: @escaping (Result<String, Error>) -> Void) {
    // payload_b64 / response_b64 are already-base64 end to end — the engine
    // encodes before calling and decodes the result, so this must NOT re-encode
    // either side.
    let seconds = TimeInterval(timeoutMs) / 1000
    request("POST", "\(Self.apiPrefix)/sessions/\(sessionId)/exchange",
            body: ["payload_b64": payloadB64, "timeout_ms": timeoutMs],
            timeout: seconds + Self.exchangeBuffer) { result in
      completion(result.flatMap { json in
        guard let response = json?["response_b64"] as? String else {
          return .failure(TransportError.malformed("the Pi returned no response_b64"))
        }
        return .success(response)
      })
    }
  }

  public func closeSession(sessionId: String, completion: @escaping () -> Void) {
    // Best-effort: a session the Pi still holds is reaped on its side, and
    // failing the send because cleanup failed would be strictly worse.
    request("DELETE", "\(Self.apiPrefix)/sessions/\(sessionId)", body: nil,
            timeout: Self.defaultTimeout) { _ in completion() }
  }

  // MARK: - Plumbing

  public enum TransportError: Error, LocalizedError {
    case badUrl(String)
    case http(Int, String)
    case network(String)
    case malformed(String)

    public var errorDescription: String? {
      switch self {
      case .badUrl(let u): return "invalid Pi URL: \(u)"
      case .http(let code, let body):
        // 401 is the one worth naming: it means the token is wrong or revoked,
        // which is a fix the user can act on, unlike a generic 5xx.
        return code == 401 ? "the Pi rejected our token (401)" : "the Pi returned HTTP \(code) \(body)"
      case .network(let m): return m
      case .malformed(let m): return m
      }
    }
  }

  private func request(_ method: String, _ path: String, body: [String: Any]?,
                       timeout: TimeInterval,
                       completion: @escaping (Result<[String: Any]?, Error>) -> Void) {
    guard let url = URL(string: baseUrl + path) else {
      return completion(.failure(TransportError.badUrl(baseUrl + path)))
    }
    var req = URLRequest(url: url, timeoutInterval: timeout)
    req.httpMethod = method
    req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    if let body = body {
      req.setValue("application/json", forHTTPHeaderField: "Content-Type")
      req.httpBody = try? JSONSerialization.data(withJSONObject: body)
    }

    session.dataTask(with: req) { data, response, error in
      if let error = error {
        return completion(.failure(TransportError.network(error.localizedDescription)))
      }
      let code = (response as? HTTPURLResponse)?.statusCode ?? 0
      guard (200..<300).contains(code) else {
        let text = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
        return completion(.failure(TransportError.http(code, String(text.prefix(200)))))
      }
      guard let data = data, !data.isEmpty else { return completion(.success(nil)) }
      completion(.success((try? JSONSerialization.jsonObject(with: data)) as? [String: Any]))
    }.resume()
  }
}
