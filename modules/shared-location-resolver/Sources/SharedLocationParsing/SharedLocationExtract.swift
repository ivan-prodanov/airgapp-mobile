import Foundation

public enum ShareSource: String { case apple, google, waze, unknown }
public struct Coord: Equatable {
  public let latitude: Double; public let longitude: Double
  public init(latitude: Double, longitude: Double) { self.latitude = latitude; self.longitude = longitude }
}
public struct RawExtract: Equatable {
  public let coordinate: Coord?; public let name: String?; public let address: String?; public let source: ShareSource
  public init(coordinate: Coord?, name: String?, address: String?, source: ShareSource) {
    self.coordinate = coordinate; self.name = name; self.address = address; self.source = source
  }
}

public enum SharedLocationExtract {
  private static let geohashAlphabet = Array("0123456789bcdefghjkmnpqrstuvwxyz")

  public static func decodeGeohash(_ hash: String) -> Coord {
    var latLo = -90.0, latHi = 90.0, lonLo = -180.0, lonHi = 180.0
    var even = true
    for ch in hash.lowercased() {
      guard let idx = geohashAlphabet.firstIndex(of: ch) else { continue }
      for bit in stride(from: 4, through: 0, by: -1) {
        let on = (idx >> bit) & 1
        if even { let mid = (lonLo + lonHi) / 2; if on == 1 { lonLo = mid } else { lonHi = mid } }
        else    { let mid = (latLo + latHi) / 2; if on == 1 { latLo = mid } else { latHi = mid } }
        even.toggle()
      }
    }
    return Coord(latitude: (latLo + latHi) / 2, longitude: (lonLo + lonHi) / 2)
  }

  public static func firstUrl(in raw: String) -> String? {
    firstMatch(#"https?://[^\s]+"#, in: raw, groups: 0)?.first
  }

  private static let shortLinkRE = #"^https?://(maps\.app\.goo\.gl|goo\.gl/maps|g\.co/kgs|maps\.apple/p)"#
  public static func isShortLink(_ url: String) -> Bool {
    firstMatch(shortLinkRE, in: url, groups: 0, caseInsensitive: true) != nil
  }

  static func safeDecode(_ s: String) -> String { s.removingPercentEncoding ?? s }

  static func validCoord(_ latRaw: Double, _ lngRaw: Double) -> Coord? {
    var lat = latRaw, lng = lngRaw
    if lat.isNaN || lng.isNaN { return nil }
    if abs(lat) > 90 && abs(lng) <= 90 { swap(&lat, &lng) }
    if abs(lat) > 90 || abs(lng) > 180 { return nil }
    if lat == 0 && lng == 0 { return nil }
    return Coord(latitude: lat, longitude: lng)
  }

  static func parseLatLng(_ s: String?) -> Coord? {
    guard let s = s,
          let m = firstMatch(#"^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$"#, in: s, groups: 2),
          m.count == 2, let a = Double(m[0]), let b = Double(m[1]) else { return nil }
    return validCoord(a, b)
  }

  static func hostSource(_ host: String) -> ShareSource {
    if host.contains("waze.com") { return .waze }
    if host.contains("apple") { return .apple }
    if host.contains("google.") || host.contains("goo.gl") || host.contains("g.co") { return .google }
    return .unknown
  }

  // URLSearchParams-parity query lookup: `+`→space FIRST (on the still-percent-encoded value), THEN
  // percent-decode — so an escaped literal `+` (%2B) survives, matching JS URLSearchParams order.
  // (`URLComponents.queryItems` percent-decodes but never turns `+` into space; blanket-replacing `+`
  // AFTER that decode — the old bug — corrupts an escaped literal `+` into a space.) Callers must pass
  // `comps.percentEncodedQueryItems`, not `comps.queryItems`.
  private static func queryValue(_ items: [URLQueryItem]?, _ name: String) -> String? {
    guard let raw = items?.first(where: { $0.name == name })?.value else { return nil }
    let spaced = raw.replacingOccurrences(of: "+", with: "%20")
    return spaced.removingPercentEncoding ?? raw.replacingOccurrences(of: "+", with: " ")
  }

  // Lone `%` (not %HH) breaks URLComponents — pre-encode it so parsing stays lenient like JS `new URL`.
  private static func sanitizePercent(_ s: String) -> String {
    firstReplace(#"%(?![0-9A-Fa-f]{2})"#, in: s, with: "%25")
  }

  public static func extract(fromUrl url: String) -> RawExtract? {
    var norm = url.trimmingCharacters(in: .whitespaces)
    if norm.hasPrefix("http:") { norm = "https:" + norm.dropFirst("http:".count) }
    guard let comps = URLComponents(string: sanitizePercent(norm)), let host = comps.host else { return nil }
    // JS `URL.hostname` is always lowercased; `URLComponents.host` preserves case, so lowercase it here
    // to keep hostSource() (and the consent-domain check below) case-insensitive like the oracle.
    let source = hostSource(host.lowercased())
    if source == .unknown { return nil }
    let qp = comps.queryItems
    // Still-percent-encoded query items for queryValue() — see its doc comment for why.
    let qpEncoded = comps.percentEncodedQueryItems
    let decoded = safeDecode(norm)

    // Google EU consent interstitial wraps the real URL in `continue` — take it RAW (no +→space; it's a URL,
    // and converting + to spaces would make URLComponents reject the recursed string).
    if host.lowercased().contains("consent.google") || comps.path.hasPrefix("/sorry") {
      if let cont = qp?.first(where: { $0.name == "continue" })?.value { return extract(fromUrl: cont) }
    }

    if source == .apple {
      let coord = parseLatLng(queryValue(qpEncoded, "ll")) ?? parseLatLng(queryValue(qpEncoded, "coordinate"))
      let qCoord = parseLatLng(queryValue(qpEncoded, "q"))
      let label = (qCoord != nil ? nil : queryValue(qpEncoded, "q")) ?? queryValue(qpEncoded, "name")
      return RawExtract(coordinate: coord ?? qCoord, name: label?.trimmingCharacters(in: .whitespaces),
                        address: queryValue(qpEncoded, "address"), source: source)
    }

    if source == .waze {
      if let gh = firstMatch(#"/ul/h([0-9bcdefghjkmnpqrstuvwxyz]+)"#, in: comps.path, groups: 1, caseInsensitive: true),
         let h = gh.first {
        return RawExtract(coordinate: decodeGeohash(h), name: nil, address: nil, source: source)
      }
      let to = queryValue(qpEncoded, "to")
      let toCoord = (to?.hasPrefix("ll.") == true) ? parseLatLng(String(to!.dropFirst(3))) : nil
      let coord = parseLatLng(queryValue(qpEncoded, "ll")) ?? toCoord
      return RawExtract(coordinate: coord, name: nil, address: nil, source: source)
    }

    // google
    func pair(_ m: [String]?) -> Coord? {
      guard let m = m, m.count == 2, let a = Double(m[0]), let b = Double(m[1]) else { return nil }
      return validCoord(a, b)
    }
    let d = firstMatch(#"!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)"#, in: decoded, groups: 2)
    let at = firstMatch(#"@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)"#, in: decoded, groups: 2)
    let qCoord = parseLatLng(queryValue(qpEncoded, "q")) ?? parseLatLng(queryValue(qpEncoded, "query")) ?? parseLatLng(queryValue(qpEncoded, "ll"))
    let coord = pair(d) ?? qCoord ?? pair(at)
    let placeSeg = firstMatch(#"/place/([^/@]+)"#, in: comps.path, groups: 1)?.first
    let name = placeSeg.map { safeDecode($0).replacingOccurrences(of: "+", with: " ") }
    let qName = qCoord == nil ? (queryValue(qpEncoded, "q") ?? queryValue(qpEncoded, "query"))?.trimmingCharacters(in: .whitespaces) : nil
    return RawExtract(coordinate: coord, name: name ?? qName, address: coord != nil ? nil : qName, source: source)
  }

  // MARK: - regex helpers (NSRegularExpression for portability)
  private static func firstMatch(_ pattern: String, in s: String, groups: Int, caseInsensitive: Bool = false) -> [String]? {
    let opts: NSRegularExpression.Options = caseInsensitive ? [.caseInsensitive] : []
    guard let re = try? NSRegularExpression(pattern: pattern, options: opts) else { return nil }
    let range = NSRange(s.startIndex..<s.endIndex, in: s)
    guard let m = re.firstMatch(in: s, options: [], range: range) else { return nil }
    if groups == 0 { return Range(m.range, in: s).map { [String(s[$0])] } }
    var out: [String] = []
    for i in 1...groups {
      guard i < m.numberOfRanges, let r = Range(m.range(at: i), in: s) else { return nil }
      out.append(String(s[r]))
    }
    return out
  }
  private static func firstReplace(_ pattern: String, in s: String, with repl: String) -> String {
    guard let re = try? NSRegularExpression(pattern: pattern) else { return s }
    let range = NSRange(s.startIndex..<s.endIndex, in: s)
    return re.stringByReplacingMatches(in: s, options: [], range: range, withTemplate: repl)
  }
}
