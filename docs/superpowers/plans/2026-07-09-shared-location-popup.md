# Shared-Location Share-Extension Popup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace airgapp's headless share-capture card with a native UIKit popup — map + Apple-Maps-style place panel + **Navigate** / **Add to Trip** — that resolves the shared location natively and queues the chosen action to the App Group for the app to apply on next foreground.

**Architecture:** The pure URL/geohash parser is ported from JS (`services/sharedLocation.ts`) to a **tracked, Foundation-only SwiftPM package** (`modules/shared-location-resolver/`) that `swift test` verifies on macOS against the existing JS test vectors. The gitignored extension (`ios/ShareExtension/`) adds an **async resolver** (URLSession unwrap + MKLocalSearch geocode + CLGeocoder reverse-geocode) over that pure core, plus the **popup UI**; on a button tap it writes a resolved `{location, action, raw}` intent to the App Group. The `SharedIntake` native module returns that intent to the app, which applies the action (→ Trip view). The signed "send to car" is left as a documented native seam.

**Tech Stack:** Swift 6.3 / SwiftPM (`swift test`), UIKit + MapKit + CoreLocation (extension), Expo local module (`modules/shared-intake`), React Native / TypeScript (app), `xcodeproj` Ruby gem for target wiring, `node --import tsx --test` for JS tests.

## Global Constraints

- **Never run `expo prebuild`** — `ios/` is hand-maintained + embeds Godot. Native target/file wiring goes through the `xcodeproj` gem under `ios/scripts/`.
- **`ios/` is gitignored** — files under `ios/ShareExtension/` are NOT committed; their "deliverable" is a green on-device verification, not a git commit. Only `modules/`, `src/`, and `docs/` changes are committed.
- **App Group** `group.local.airgapp.mobile` is the only cross-process channel (already entitled on app + extension).
- **Signing** team `859B8N529C`, automatic; extension Info.plist must keep `CFBundleExecutable=$(EXECUTABLE_NAME)`.
- Bundle id `local.airgapp.mobile`; device `F3867E6E-E95F-5B2A-9C4E-06D1D72475A1`.
- **The JS parser test vectors are the Swift resolver's acceptance spec** — every vector in `src/services/sharedLocation.test.ts` must have a matching Swift test.
- Future signed-send must not hardcode any Tesla endpoint (targets the user's own car/RPi only). Not built here.
- Deploy: one `xcodebuild` Release for native, then `bash scripts/godot-ios/deploy-js.sh` for JS iterations.

---

## File Structure

**Tracked (committed):**
- `modules/shared-location-resolver/Package.swift` — SwiftPM manifest (Foundation-only library + test target).
- `modules/shared-location-resolver/Sources/SharedLocationParsing/SharedLocationExtract.swift` — pure port of the parser's synchronous core. **The extension compiles this exact file via a file reference.**
- `modules/shared-location-resolver/Tests/SharedLocationParsingTests/SharedLocationExtractTests.swift` — the ported vectors.
- `modules/shared-intake/ios/SharedIntakeModule.swift` — gains `consumeSharedIntent` + `setSavedTrip`.
- `modules/shared-intake/src/SharedIntakeModule.ts` — updated decl.
- `src/state/sharedLocationStore.ts` — payload gains `action`.
- `src/state/sharedLocationStore.test.ts` — new payload coverage.
- `src/hooks/useSharedLocationIntake.ts` — consume intent + apply action + raw fallback.
- `src/app/location.tsx` — shared effect switches on action; `savedTripExists` mirror effect.

**Gitignored (device-verified, not committed):**
- `ios/ShareExtension/SharedLocationResolver.swift` — async resolver (network + MapKit) over the pure core.
- `ios/ShareExtension/SharePreviewView.swift` — the card view (MKMapView + panel + buttons).
- `ios/ShareExtension/ShareViewController.swift` — rewritten popup controller.
- `ios/scripts/add_share_resolver_files.rb` — registers the new Swift files (incl. the file-reference into the SwiftPM package) to the ShareExtension target.

---

## Task 1: Pure Swift extraction core + SwiftPM tests (TDD on macOS)

Port the **synchronous** parser core (everything in `sharedLocation.ts` except the async `parseSharedLocation`) to a tracked, Foundation-only SwiftPM package, TDD'd against the JS vectors.

**Files:**
- Create: `modules/shared-location-resolver/Package.swift`
- Create: `modules/shared-location-resolver/Sources/SharedLocationParsing/SharedLocationExtract.swift`
- Test: `modules/shared-location-resolver/Tests/SharedLocationParsingTests/SharedLocationExtractTests.swift`

**Interfaces:**
- Produces (public API the extension + later tasks rely on):
  - `enum ShareSource: String { case apple, google, waze, unknown }`
  - `struct Coord: Equatable { let latitude: Double; let longitude: Double }`
  - `struct RawExtract: Equatable { let coordinate: Coord?; let name: String?; let address: String?; let source: ShareSource }`
  - `enum SharedLocationExtract { static func extract(fromUrl: String) -> RawExtract?; static func decodeGeohash(_ hash: String) -> Coord; static func firstUrl(in raw: String) -> String?; static func isShortLink(_ url: String) -> Bool }`

- [ ] **Step 1: Create the SwiftPM manifest**

Create `modules/shared-location-resolver/Package.swift`:

```swift
// swift-tools-version:5.9
import PackageDescription

let package = Package(
  name: "SharedLocationParsing",
  platforms: [.macOS(.v13), .iOS(.v16)],
  products: [.library(name: "SharedLocationParsing", targets: ["SharedLocationParsing"])],
  targets: [
    .target(name: "SharedLocationParsing"),
    .testTarget(name: "SharedLocationParsingTests", dependencies: ["SharedLocationParsing"]),
  ]
)
```

- [ ] **Step 2: Write the failing tests (the ported JS vectors)**

Create `modules/shared-location-resolver/Tests/SharedLocationParsingTests/SharedLocationExtractTests.swift`. These mirror `src/services/sharedLocation.test.ts` one-for-one:

```swift
import XCTest
@testable import SharedLocationParsing

final class SharedLocationExtractTests: XCTestCase {
  private func near(_ a: Double, _ b: Double, _ eps: Double = 1e-3, _ msg: String = "") {
    XCTAssertLessThan(abs(a - b), eps, "\(a) !~= \(b) \(msg)")
  }

  func testGeohashCanonicalEzs42() {
    let c = SharedLocationExtract.decodeGeohash("ezs42")
    near(c.latitude, 42.605, 1e-2); near(c.longitude, -5.603, 1e-2)
  }
  func testGeohashTimesSquare() {
    let c = SharedLocationExtract.decodeGeohash("dr5ru7vtv2")
    near(c.latitude, 40.7588938, 1e-4); near(c.longitude, -73.985136, 1e-4)
  }
  func testAppleLlIsPinQIsLabel() {
    let r = SharedLocationExtract.extract(fromUrl: "https://maps.apple.com/?address=X&auid=1&ll=41.890221,12.492317&lsp=9902&q=Colosseum&t=m")
    XCTAssertEqual(r?.source, .apple)
    near(r!.coordinate!.latitude, 41.890221); near(r!.coordinate!.longitude, 12.492317)
    XCTAssertEqual(r?.name, "Colosseum")
  }
  func testAppleUnifiedCoordinate() {
    let r = SharedLocationExtract.extract(fromUrl: "https://maps.apple.com/place?coordinate=40.864791,-73.931723&name=My%20Place")
    near(r!.coordinate!.latitude, 40.864791); XCTAssertEqual(r?.name, "My Place")
  }
  func testAppleIgnoresSll() {
    let r = SharedLocationExtract.extract(fromUrl: "https://maps.apple.com/?q=pizza&sll=50.894967,4.341626&z=10")
    XCTAssertNil(r?.coordinate); XCTAssertEqual(r?.name, "pizza")
  }
  func testApplePlaceIdOnly() {
    let r = SharedLocationExtract.extract(fromUrl: "https://maps.apple.com/place?place-id=I63802885C8189B2B")
    XCTAssertNil(r?.coordinate)
  }
  func testGooglePrefers3d4dOverCamera() {
    let r = SharedLocationExtract.extract(fromUrl: "https://www.google.com/maps/place/Eiffel+Tower/@48.85,2.29,17z/data=!3m5!8m2!3d48.8582602!4d2.2944991")
    XCTAssertEqual(r?.source, .google)
    near(r!.coordinate!.latitude, 48.8582602); near(r!.coordinate!.longitude, 2.2944991)
    XCTAssertEqual(r?.name, "Eiffel Tower")
  }
  func testGoogleCameraFallback() {
    let r = SharedLocationExtract.extract(fromUrl: "https://www.google.com/maps/@52.520008,13.404954,15z")
    near(r!.coordinate!.latitude, 52.520008); near(r!.coordinate!.longitude, 13.404954)
  }
  func testGoogleQLatLng() {
    let r = SharedLocationExtract.extract(fromUrl: "https://maps.google.com/?q=48.8584,2.2945")
    near(r!.coordinate!.latitude, 48.8584)
  }
  func testWazeLl() {
    let r = SharedLocationExtract.extract(fromUrl: "https://www.waze.com/ul?ll=40.75889500%2C-73.98513100&navigate=yes&zoom=17")
    XCTAssertEqual(r?.source, .waze); near(r!.coordinate!.latitude, 40.758895)
  }
  func testWazeToLl() {
    let r = SharedLocationExtract.extract(fromUrl: "https://www.waze.com/live-map/directions?to=ll.40.7589%2C-73.9851&from=ll.40.68%2C-74.04")
    near(r!.coordinate!.latitude, 40.7589); near(r!.coordinate!.longitude, -73.9851)
  }
  func testWazeGeohashPath() {
    let r = SharedLocationExtract.extract(fromUrl: "https://www.waze.com/ul/hdr5ru7vtv2")
    near(r!.coordinate!.latitude, 40.7588938, 1e-4)
  }
  func testInRangeCoord() {
    let r = SharedLocationExtract.extract(fromUrl: "https://maps.apple.com/?ll=12.492317,41.890221")
    XCTAssertTrue(abs(r!.coordinate!.latitude) <= 90 && abs(r!.coordinate!.longitude) <= 180)
  }
  func testNonMapUrlNil() {
    XCTAssertNil(SharedLocationExtract.extract(fromUrl: "https://example.com/foo"))
  }
  func testStrayPercentInUrl() {
    let r = SharedLocationExtract.extract(fromUrl: "https://maps.apple.com/?ll=41.890221,12.492317&q=Deal%20-%2050%25%20off%20SAVE%")
    near(r!.coordinate!.latitude, 41.890221)
  }
  func testStrayPercentInGooglePlaceName() {
    let r = SharedLocationExtract.extract(fromUrl: "https://www.google.com/maps/place/foo%/@48.8582602,2.2944991,17z/data=!3d48.8582602!4d2.2944991")
    near(r!.coordinate!.latitude, 48.8582602)
  }
  func testConsentContinueUnwrapNameAsAddress() {
    let r = SharedLocationExtract.extract(fromUrl: "https://consent.google.com/ml?continue=https://maps.google.com/maps?q%3DKeros%2BBay%2BView,%2BKeros,%2BGreece%26ftid%3D0x1:0x2&m=1&gl=BG")
    XCTAssertEqual(r?.source, .google); XCTAssertNil(r?.coordinate)
    XCTAssertEqual(r?.address, "Keros Bay View, Keros, Greece")
  }
  func testIsShortLink() {
    XCTAssertTrue(SharedLocationExtract.isShortLink("https://maps.apple/p/6zSLmCMDQ0HYAr"))
    XCTAssertFalse(SharedLocationExtract.isShortLink("https://maps.apple.com/place?coordinate=1,2"))
  }
  func testFirstUrlFromText() {
    XCTAssertEqual(SharedLocationExtract.firstUrl(in: "Colosseum\nhttps://maps.apple.com/?ll=41.89,12.49&q=Colosseum"),
                   "https://maps.apple.com/?ll=41.89,12.49&q=Colosseum")
  }
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd modules/shared-location-resolver && swift test`
Expected: FAIL — `SharedLocationExtract` / types not found (compile error).

- [ ] **Step 4: Implement the pure core**

Create `modules/shared-location-resolver/Sources/SharedLocationParsing/SharedLocationExtract.swift`. Port `sharedLocation.ts` faithfully. **Port pitfalls to get right (the tests above pin them):** (a) `URLSearchParams` decodes `+`→space — Swift `URLComponents` does not, so replace `+`→space in query values; (b) a stray `%` makes `URLComponents(string:)` return nil — pre-encode lone `%` as `%25` before parsing; (c) `decodeURIComponent`→ `removingPercentEncoding` (may be nil → keep original).

```swift
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
  public static func isShortLink(_ url: String) -> Bool { firstMatch(shortLinkRE, in: url, groups: 0) != nil }

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

  // URLSearchParams-parity query lookup: percent-decoded (URLComponents) + `+`→space.
  private static func queryValue(_ items: [URLQueryItem]?, _ name: String) -> String? {
    guard let v = items?.first(where: { $0.name == name })?.value else { return nil }
    return v.replacingOccurrences(of: "+", with: " ")
  }

  // Lone `%` (not %HH) breaks URLComponents — pre-encode it so parsing stays lenient like JS `new URL`.
  private static func sanitizePercent(_ s: String) -> String {
    firstReplace(#"%(?![0-9A-Fa-f]{2})"#, in: s, with: "%25")
  }

  public static func extract(fromUrl url: String) -> RawExtract? {
    var norm = url.trimmingCharacters(in: .whitespaces)
    if norm.hasPrefix("http:") { norm = "https:" + norm.dropFirst("http:".count) }
    guard let comps = URLComponents(string: sanitizePercent(norm)), let host = comps.host else { return nil }
    let source = hostSource(host)
    if source == .unknown { return nil }
    let qp = comps.queryItems
    let decoded = safeDecode(norm)

    // Google EU consent interstitial wraps the real URL in `continue` — take it RAW (no +→space; it's a URL,
    // and converting + to spaces would make URLComponents reject the recursed string).
    if host.contains("consent.google") || comps.path.hasPrefix("/sorry") {
      if let cont = qp?.first(where: { $0.name == "continue" })?.value { return extract(fromUrl: cont) }
    }

    if source == .apple {
      let coord = parseLatLng(queryValue(qp, "ll")) ?? parseLatLng(queryValue(qp, "coordinate"))
      let qCoord = parseLatLng(queryValue(qp, "q"))
      let label = (qCoord != nil ? nil : queryValue(qp, "q")) ?? queryValue(qp, "name")
      return RawExtract(coordinate: coord ?? qCoord, name: label?.trimmingCharacters(in: .whitespaces),
                        address: queryValue(qp, "address"), source: source)
    }

    if source == .waze {
      if let gh = firstMatch(#"/ul/h([0-9bcdefghjkmnpqrstuvwxyz]+)"#, in: comps.path, groups: 1, caseInsensitive: true),
         let h = gh.first {
        return RawExtract(coordinate: decodeGeohash(h), name: nil, address: nil, source: source)
      }
      let to = queryValue(qp, "to")
      let toCoord = (to?.hasPrefix("ll.") == true) ? parseLatLng(String(to!.dropFirst(3))) : nil
      let coord = parseLatLng(queryValue(qp, "ll")) ?? toCoord
      return RawExtract(coordinate: coord, name: nil, address: nil, source: source)
    }

    // google
    func pair(_ m: [String]?) -> Coord? {
      guard let m = m, m.count == 2, let a = Double(m[0]), let b = Double(m[1]) else { return nil }
      return validCoord(a, b)
    }
    let d = firstMatch(#"!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)"#, in: decoded, groups: 2)
    let at = firstMatch(#"@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)"#, in: decoded, groups: 2)
    let qCoord = parseLatLng(queryValue(qp, "q")) ?? parseLatLng(queryValue(qp, "query")) ?? parseLatLng(queryValue(qp, "ll"))
    let coord = pair(d) ?? qCoord ?? pair(at)
    let placeSeg = firstMatch(#"/place/([^/@]+)"#, in: comps.path, groups: 1)?.first
    let name = placeSeg.map { safeDecode($0).replacingOccurrences(of: "+", with: " ") }
    let qName = qCoord == nil ? (queryValue(qp, "q") ?? queryValue(qp, "query"))?.trimmingCharacters(in: .whitespaces) : nil
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd modules/shared-location-resolver && swift test`
Expected: PASS — all vectors green. (Iterate on the port pitfalls in Step 4 until green.)

- [ ] **Step 6: Commit**

```bash
git add modules/shared-location-resolver
git commit -m "feat(share-popup): pure Swift extraction core + ported vectors"
```

---

## Task 2: Async native resolver (`SharedLocationResolver.swift`)

Wrap Task 1's pure core with the network + geocode steps `parseSharedLocation` performs, plus an `MKMapItem` fast path and reverse-geocoding for the address line. Lives in the gitignored extension tree; **verified on-device in Task 6** (network/MapKit can't be meaningfully unit-tested here).

**Files:**
- Create: `ios/ShareExtension/SharedLocationResolver.swift`

**Interfaces:**
- Consumes: `SharedLocationExtract`, `RawExtract`, `Coord`, `ShareSource` (Task 1).
- Produces:
  - `struct ResolvedLocation { let latitude: Double; let longitude: Double; let name: String?; let address: String?; let source: ShareSource }`
  - `enum SharedLocationResolver { static func resolve(mapItem: MKMapItem, completion: @escaping (ResolvedLocation?) -> Void); static func resolve(raw: String, completion: @escaping (ResolvedLocation?) -> Void) }`

- [ ] **Step 1: Implement the resolver**

Create `ios/ShareExtension/SharedLocationResolver.swift`:

```swift
import Foundation
import MapKit
import CoreLocation

struct ResolvedLocation {
  let latitude: Double; let longitude: Double
  let name: String?; let address: String?; let source: ShareSource
}

enum SharedLocationResolver {
  private static let timeout: TimeInterval = 8

  // Apple share: MKMapItem gives name + coordinate + postal address with no network.
  static func resolve(mapItem: MKMapItem, completion: @escaping (ResolvedLocation?) -> Void) {
    let c = mapItem.placemark.coordinate
    let addr = postalString(mapItem.placemark)
    completion(ResolvedLocation(latitude: c.latitude, longitude: c.longitude,
                                name: mapItem.name, address: addr, source: .apple))
  }

  static func resolve(raw: String, completion: @escaping (ResolvedLocation?) -> Void) {
    guard let url = SharedLocationExtract.firstUrl(in: raw) else { return completion(nil) }

    // 1) Direct sync extraction.
    if let ex = SharedLocationExtract.extract(fromUrl: url), let c = ex.coordinate {
      return enrichAddress(ex, c, completion)
    }

    // 2) Short link → resolve, re-extract over final URL + body.
    if SharedLocationExtract.isShortLink(url) {
      fetch(url) { finalUrl, body in
        if let finalUrl = finalUrl, let ex = SharedLocationExtract.extract(fromUrl: finalUrl), let c = ex.coordinate {
          return enrichAddress(ex, c, completion)
        }
        if let body = body, let c = coordsInBody(body) {
          return enrichAddress(RawExtract(coordinate: c, name: nil, address: nil, source: .google), c, completion)
        }
        // 3) Address-only (e.g. consent wall name) → geocode.
        let ex = finalUrl.flatMap { SharedLocationExtract.extract(fromUrl: $0) }
        geocodeFallback(ex, completion)
      }
      return
    }

    // 3) Address-only without a short link → geocode.
    geocodeFallback(SharedLocationExtract.extract(fromUrl: url), completion)
  }

  // MARK: helpers
  private static func enrichAddress(_ ex: RawExtract, _ c: Coord, _ completion: @escaping (ResolvedLocation?) -> Void) {
    if let a = ex.address, !a.isEmpty {
      return completion(ResolvedLocation(latitude: c.latitude, longitude: c.longitude, name: ex.name, address: a, source: ex.source))
    }
    let loc = CLLocation(latitude: c.latitude, longitude: c.longitude)
    CLGeocoder().reverseGeocodeLocation(loc) { marks, _ in
      let addr = marks?.first.map { postalString($0) } ?? nil
      completion(ResolvedLocation(latitude: c.latitude, longitude: c.longitude, name: ex.name, address: addr, source: ex.source))
    }
  }

  private static func geocodeFallback(_ ex: RawExtract?, _ completion: @escaping (ResolvedLocation?) -> Void) {
    guard let address = ex?.address, !address.isEmpty else { return completion(nil) }
    let req = MKLocalSearch.Request()
    req.naturalLanguageQuery = address
    req.region = MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: 42.7, longitude: 23.32),
                                    span: MKCoordinateSpan(latitudeDelta: 30, longitudeDelta: 30))
    let search = MKLocalSearch(request: req)
    let done = Timed(completion)
    search.start { resp, _ in
      guard let item = resp?.mapItems.first else { return done.fire(nil) }
      let c = item.placemark.coordinate
      done.fire(ResolvedLocation(latitude: c.latitude, longitude: c.longitude,
                                 name: ex?.name ?? item.name, address: postalString(item.placemark), source: ex?.source ?? .unknown))
    }
    done.arm(after: timeout) { search.cancel() }
  }

  private static func coordsInBody(_ body: String) -> Coord? {
    for pat in [#"!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)"#, #"@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)"#] {
      if let re = try? NSRegularExpression(pattern: pat) {
        let r = NSRange(body.startIndex..<body.endIndex, in: body)
        if let m = re.firstMatch(in: body, range: r),
           let r1 = Range(m.range(at: 1), in: body), let r2 = Range(m.range(at: 2), in: body),
           let a = Double(body[r1]), let b = Double(body[r2]),
           abs(a) <= 90, abs(b) <= 180, !(a == 0 && b == 0) {
          return Coord(latitude: a, longitude: b)
        }
      }
    }
    return nil
  }

  private static func fetch(_ url: String, _ completion: @escaping (String?, String?) -> Void) {
    guard let u = URL(string: url) else { return completion(nil, nil) }
    var req = URLRequest(url: u, timeoutInterval: timeout)
    req.setValue("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", forHTTPHeaderField: "User-Agent")
    req.setValue("CONSENT=YES+cb; SOCS=CAISNQgDEitib3E", forHTTPHeaderField: "Cookie")
    URLSession.shared.dataTask(with: req) { data, resp, _ in
      let finalUrl = (resp?.url?.absoluteString)
      let body = data.flatMap { String(data: $0, encoding: .utf8) }
      completion(finalUrl, body)
    }.resume()
  }

  private static func postalString(_ p: CLPlacemark) -> String? {
    let parts = [p.subThoroughfare, p.thoroughfare, p.locality, p.administrativeArea].compactMap { $0 }
    return parts.isEmpty ? nil : parts.joined(separator: " ")
  }
}

// Fire a completion at most once, with an optional timeout.
private final class Timed {
  private var done = false
  private let cb: (ResolvedLocation?) -> Void
  init(_ cb: @escaping (ResolvedLocation?) -> Void) { self.cb = cb }
  func fire(_ v: ResolvedLocation?) { if !done { done = true; DispatchQueue.main.async { self.cb(v) } } }
  func arm(after t: TimeInterval, _ onTimeout: @escaping () -> Void) {
    DispatchQueue.main.asyncAfter(deadline: .now() + t) { if !self.done { onTimeout(); self.fire(nil) } }
  }
}
```

- [ ] **Step 2: Verify it compiles (deferred device verification)**

There is no standalone build for a single gitignored extension file; correctness is verified end-to-end in **Task 6** (on-device: an Apple map-item, a `maps.apple/p` short link, a Google `goo.gl` place, a Google city, a Waze `ll`, a Waze geohash). This step's gate is code-review against the Task-1 vectors + the Component-1 table in the spec. No git commit (gitignored).

---

## Task 3: `SharedIntake` module — `consumeSharedIntent` + `setSavedTrip`

**Files:**
- Modify: `modules/shared-intake/ios/SharedIntakeModule.swift`
- Modify: `modules/shared-intake/src/SharedIntakeModule.ts`

**Interfaces:**
- Produces:
  - `consumeSharedIntent(): Promise<string | null>` — atomic read+clear of App Group key `pendingSharedIntent` (returns the raw JSON string), also clears the legacy `pendingSharedLocation` key.
  - `setSavedTrip(exists: boolean, name: string | null): Promise<void>` — writes App Group keys `savedTripExists` (Bool) + `savedTripName` (String?).

- [ ] **Step 1: Rewrite the native module**

Replace the body of `modules/shared-intake/ios/SharedIntakeModule.swift`:

```swift
import ExpoModulesCore

// Bridges the App Group between the Share Extension and the app: reads the resolved shared intent the
// extension queued, and mirrors whether a saved trip exists so the extension can enable "Add to Trip".
public class SharedIntakeModule: Module {
  private let suite = "group.local.airgapp.mobile"
  private let intentKey = "pendingSharedIntent"
  private let legacyKey = "pendingSharedLocation"

  public func definition() -> ModuleDefinition {
    Name("SharedIntake")

    AsyncFunction("consumeSharedIntent") { () -> String? in
      guard let defaults = UserDefaults(suiteName: self.suite) else { return nil }
      defaults.removeObject(forKey: self.legacyKey) // discard any pre-popup payload format
      guard let json = defaults.string(forKey: self.intentKey) else { return nil }
      defaults.removeObject(forKey: self.intentKey)
      defaults.synchronize()
      return json.isEmpty ? nil : json
    }

    AsyncFunction("setSavedTrip") { (exists: Bool, name: String?) in
      guard let defaults = UserDefaults(suiteName: self.suite) else { return }
      defaults.set(exists, forKey: "savedTripExists")
      if let name = name { defaults.set(name, forKey: "savedTripName") }
      else { defaults.removeObject(forKey: "savedTripName") }
      defaults.synchronize()
    }
  }
}
```

- [ ] **Step 2: Update the TS declaration**

Replace `modules/shared-intake/src/SharedIntakeModule.ts`:

```typescript
import { requireNativeModule } from 'expo';

declare class SharedIntakeModule {
  // Atomically read + clear the App Group's resolved shared intent JSON (or null). Also clears any legacy payload.
  consumeSharedIntent(): Promise<string | null>;
  // Mirror whether a saved trip exists (+ its name) so the Share Extension can enable/label "Add to Trip".
  setSavedTrip(exists: boolean, name: string | null): Promise<void>;
}

export default requireNativeModule<SharedIntakeModule>('SharedIntake');
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS (no errors from these files; call sites are updated in Tasks 4–5). Note: `useSharedLocationIntake.ts` still references the old `consumePendingShare` at this point — if tsc flags it, that is expected and fixed in Task 5; scope this check to "no NEW errors in the two edited files".

- [ ] **Step 4: Commit**

```bash
git add modules/shared-intake/ios/SharedIntakeModule.swift modules/shared-intake/src/SharedIntakeModule.ts
git commit -m "feat(share-popup): SharedIntake consumeSharedIntent + setSavedTrip"
```

---

## Task 4: Native popup — `SharePreviewView` + `ShareViewController` rewrite

Build the card and wire the controller: load attachment → resolve (Task 2) → present card (map + panel + buttons, Add-to-Trip gated on `savedTripExists`) → on tap write the intent to the App Group → `completeRequest`. Gitignored; **verified on-device in Task 6**.

**Files:**
- Create: `ios/ShareExtension/SharePreviewView.swift`
- Modify (full rewrite): `ios/ShareExtension/ShareViewController.swift`

**Interfaces:**
- Consumes: `SharedLocationResolver`, `ResolvedLocation` (Task 2).
- App Group writes: key `pendingSharedIntent` = JSON `{ location: {lat,lng,name?,address?,source}, action: "navigate"|"addToTrip", raw: string, ts: number }`.
- App Group reads: `savedTripExists` (Bool), `savedTripName` (String?).

- [ ] **Step 1: Build the card view**

Create `ios/ShareExtension/SharePreviewView.swift`:

```swift
import UIKit
import MapKit

final class SharePreviewView: UIView {
  let map = MKMapView()
  private let nameLabel = UILabel()
  private let addressLabel = UILabel()
  private let navigateButton = UIButton(type: .system)
  private let addTripButton = UIButton(type: .system)
  private let spinner = UIActivityIndicatorView(style: .medium)

  var onNavigate: (() -> Void)?
  var onAddToTrip: (() -> Void)?

  override init(frame: CGRect) {
    super.init(frame: frame)
    backgroundColor = .systemBackground
    map.isRotateEnabled = false; map.isPitchEnabled = false
    nameLabel.font = .preferredFont(forTextStyle: .headline); nameLabel.numberOfLines = 1
    addressLabel.font = .preferredFont(forTextStyle: .subheadline); addressLabel.textColor = .secondaryLabel; addressLabel.numberOfLines = 2

    styleButton(navigateButton, title: "Navigate", filled: true)
    styleButton(addTripButton, title: "Add to Trip", filled: false)
    navigateButton.addAction(UIAction { [weak self] _ in self?.onNavigate?() }, for: .touchUpInside)
    addTripButton.addAction(UIAction { [weak self] _ in self?.onAddToTrip?() }, for: .touchUpInside)

    let buttons = UIStackView(arrangedSubviews: [navigateButton, addTripButton])
    buttons.axis = .horizontal; buttons.spacing = 12; buttons.distribution = .fillEqually
    let panel = UIStackView(arrangedSubviews: [nameLabel, addressLabel, buttons])
    panel.axis = .vertical; panel.spacing = 8; panel.isLayoutMarginsRelativeArrangement = true
    panel.layoutMargins = .init(top: 16, left: 20, bottom: 16, right: 20)

    let stack = UIStackView(arrangedSubviews: [map, panel])
    stack.axis = .vertical
    for v in [stack, spinner] { v.translatesAutoresizingMaskIntoConstraints = false; addSubview(v) }
    NSLayoutConstraint.activate([
      stack.topAnchor.constraint(equalTo: topAnchor), stack.bottomAnchor.constraint(equalTo: bottomAnchor),
      stack.leadingAnchor.constraint(equalTo: leadingAnchor), stack.trailingAnchor.constraint(equalTo: trailingAnchor),
      map.heightAnchor.constraint(equalTo: heightAnchor, multiplier: 0.55),
      spinner.centerXAnchor.constraint(equalTo: centerXAnchor), spinner.centerYAnchor.constraint(equalTo: centerYAnchor),
    ])
  }
  required init?(coder: NSCoder) { fatalError() }

  func showLoading() { spinner.startAnimating(); [navigateButton, addTripButton].forEach { $0.isEnabled = false } }

  func show(_ loc: ResolvedLocation?, savedTripExists: Bool) {
    spinner.stopAnimating()
    let name = (loc?.name?.isEmpty == false) ? loc!.name! : "Shared Location"
    nameLabel.text = name
    addressLabel.text = loc?.address
    addressLabel.isHidden = (loc?.address?.isEmpty ?? true)
    navigateButton.isEnabled = true
    addTripButton.isEnabled = savedTripExists
    addTripButton.alpha = savedTripExists ? 1 : 0.4
    if let loc = loc {
      map.isHidden = false
      let coord = CLLocationCoordinate2D(latitude: loc.latitude, longitude: loc.longitude)
      map.setRegion(MKCoordinateRegion(center: coord, latitudinalMeters: 800, longitudinalMeters: 800), animated: false)
      let pin = MKPointAnnotation(); pin.coordinate = coord; pin.title = name
      map.removeAnnotations(map.annotations); map.addAnnotation(pin)
    } else {
      map.isHidden = true
    }
  }

  private func styleButton(_ b: UIButton, title: String, filled: Bool) {
    var cfg = filled ? UIButton.Configuration.filled() : UIButton.Configuration.gray()
    cfg.title = title; cfg.cornerStyle = .large
    if filled { cfg.baseBackgroundColor = .systemBlue }
    b.configuration = cfg
  }
}
```

- [ ] **Step 2: Rewrite the controller**

Replace `ios/ShareExtension/ShareViewController.swift`:

```swift
import UIKit
import UniformTypeIdentifiers
import MapKit

// Native share popup: resolve the shared location, show a map + place panel + Navigate/Add-to-Trip, and on a
// tap queue a resolved {location, action, raw} intent into the App Group for the app to apply on next open.
// (No host-app launch — iOS blocks it for share extensions; the app drains the App Group on foreground.)
class ShareViewController: UIViewController {
  private let suite = "group.local.airgapp.mobile"
  private let mapItemType = "com.apple.mapkit.map-item"
  private let card = SharePreviewView()
  private var resolved: ResolvedLocation?
  private var rawShare: String = ""

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .clear
    card.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(card)
    NSLayoutConstraint.activate([
      card.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      card.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      card.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      card.heightAnchor.constraint(equalTo: view.heightAnchor, multiplier: 0.6),
    ])
    card.onNavigate = { [weak self] in self?.complete(action: "navigate") }
    card.onAddToTrip = { [weak self] in self?.complete(action: "addToTrip") }
    card.showLoading()
    loadAndResolve()
  }

  private var savedTripExists: Bool { UserDefaults(suiteName: suite)?.bool(forKey: "savedTripExists") ?? false }

  private func loadAndResolve() {
    guard let providers = (extensionContext?.inputItems as? [NSExtensionItem])?.flatMap({ $0.attachments ?? [] }),
          !providers.isEmpty else { return finish(nil) }

    if let p = providers.first(where: { $0.hasItemConformingToTypeIdentifier(mapItemType) }) {
      p.loadItem(forTypeIdentifier: mapItemType, options: nil) { [weak self] data, _ in
        guard let self = self else { return }
        if let mapItem = data as? MKMapItem {
          let c = mapItem.placemark.coordinate
          self.rawShare = "https://maps.apple.com/?ll=\(c.latitude),\(c.longitude)&q=\((mapItem.name ?? "").addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")"
          SharedLocationResolver.resolve(mapItem: mapItem) { self.finish($0) }
        } else { self.finish(nil) }
      }
    } else if let p = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.url.identifier) }) {
      p.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { [weak self] data, _ in
        self?.resolveRaw((data as? URL)?.absoluteString ?? (data as? String))
      }
    } else if let p = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) }) {
      p.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { [weak self] data, _ in
        self?.resolveRaw(data as? String)
      }
    } else { finish(nil) }
  }

  private func resolveRaw(_ raw: String?) {
    guard let raw = raw, !raw.isEmpty else { return finish(nil) }
    rawShare = raw
    SharedLocationResolver.resolve(raw: raw) { [weak self] in self?.finish($0) }
  }

  private func finish(_ loc: ResolvedLocation?) {
    DispatchQueue.main.async {
      self.resolved = loc
      self.card.show(loc, savedTripExists: self.savedTripExists)
    }
  }

  // Write the resolved intent and dismiss. If resolution failed, `location` is null and the app re-resolves `raw`.
  private func complete(action: String) {
    var payload: [String: Any] = ["action": action, "raw": rawShare, "ts": Date().timeIntervalSince1970 * 1000]
    if let r = resolved {
      var loc: [String: Any] = ["lat": r.latitude, "lng": r.longitude, "source": r.source.rawValue]
      if let n = r.name { loc["name"] = n }
      if let a = r.address { loc["address"] = a }
      payload["location"] = loc
    }
    if let defaults = UserDefaults(suiteName: suite),
       let data = try? JSONSerialization.data(withJSONObject: payload),
       let json = String(data: data, encoding: .utf8) {
      defaults.set(json, forKey: "pendingSharedIntent")
      defaults.synchronize()
    }
    extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
  }
}
```

- [ ] **Step 3: Deferred verification**

Compiles + is exercised on-device in **Task 6**. No git commit (gitignored).

---

## Task 5: App-side wiring — store, hook, location screen, savedTrip mirror

**Files:**
- Modify: `src/state/sharedLocationStore.ts`
- Test: `src/state/sharedLocationStore.test.ts`
- Modify: `src/hooks/useSharedLocationIntake.ts`
- Modify: `src/app/location.tsx`

**Interfaces:**
- Consumes: `SharedIntake.consumeSharedIntent()`, `SharedIntake.setSavedTrip()` (Task 3).
- `sharedLocationStore` payload becomes `{ location: SharedLocation; action: 'navigate' | 'addToTrip' }`.

- [ ] **Step 1: Write the failing store test**

Replace `src/state/sharedLocationStore.test.ts` with coverage of the new payload:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sharedLocationStore } from './sharedLocationStore';

const sample = {
  location: { coordinate: { latitude: 1, longitude: 2 }, name: 'X', source: 'apple' as const },
  action: 'navigate' as const,
};

test('set → consume returns the intent once, then null', () => {
  sharedLocationStore.set(sample);
  assert.deepEqual(sharedLocationStore.consume(), sample);
  assert.equal(sharedLocationStore.consume(), null);
});

test('subscribe fires on set', () => {
  let fired = 0;
  const unsub = sharedLocationStore.subscribe(() => { fired++; });
  sharedLocationStore.set({ ...sample, action: 'addToTrip' });
  assert.equal(fired, 1);
  sharedLocationStore.consume();
  unsub();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --import tsx --test src/state/sharedLocationStore.test.ts`
Expected: FAIL — the store still holds a bare `SharedLocation` (type/shape mismatch on `.action`).

- [ ] **Step 3: Update the store**

Replace `src/state/sharedLocationStore.ts`:

```typescript
import type { SharedLocation } from '@/services/sharedLocation';

export type SharedAction = 'navigate' | 'addToTrip';
export interface SharedIntent { location: SharedLocation; action: SharedAction }

// Module-level hand-off from the intake hook to the Location screen. `set` publishes a pending shared intent
// (resolved location + the action the user chose in the share popup) and notifies subscribers; the screen
// `consume`s it exactly once (get + clear).
let pending: SharedIntent | null = null;
const subs = new Set<() => void>();

export const sharedLocationStore = {
  set(intent: SharedIntent): void {
    pending = intent;
    subs.forEach((f) => f());
  },
  consume(): SharedIntent | null {
    const p = pending;
    pending = null;
    return p;
  },
  subscribe(cb: () => void): () => void {
    subs.add(cb);
    return () => { subs.delete(cb); };
  },
};
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node --import tsx --test src/state/sharedLocationStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Rewrite the intake hook**

Replace `src/hooks/useSharedLocationIntake.ts`. The native intent is primary; the JS parser is kept only as the degraded raw-fallback when the extension couldn't resolve (offline / goo.gl timeout):

```typescript
import { useEffect, useRef } from 'react';
import { AppState, Linking } from 'react-native';
import * as Location from 'expo-location';

import SharedIntake from '../../modules/shared-intake';
import AppleSearch, { type AppleResult } from '../../modules/expo-apple-search';
import { parseSharedLocation, type ParseDeps, type SharedLocation } from '@/services/sharedLocation';
import { sharedLocationStore, type SharedAction } from '@/state/sharedLocationStore';
import type { LatLng } from '@/state/mockLocation';

interface Intent {
  location?: { lat: number; lng: number; name?: string; address?: string; source: SharedLocation['source'] };
  action: SharedAction;
  raw: string;
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);
}

// Degraded fallback only: the native extension normally resolves. Used when `intent.location` is absent.
const deps: ParseDeps = {
  resolveUrl: async (url) => {
    try {
      const p = fetch(url, {
        redirect: 'follow',
        headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', Cookie: 'CONSENT=YES+cb; SOCS=CAISNQgDEitib3E' },
      }).then(async (res) => ({ finalUrl: res.url, body: await res.text() }));
      return await withTimeout(p, 8000, null);
    } catch { return null; }
  },
  geocode: async (address) => {
    let center = { latitude: 42.7, longitude: 23.32 };
    try { const last = await Location.getLastKnownPositionAsync(); if (last) center = { latitude: last.coords.latitude, longitude: last.coords.longitude }; } catch { /* default */ }
    const region = { latitude: center.latitude, longitude: center.longitude, latitudeDelta: 30, longitudeDelta: 30 };
    const trySearch = async (q: string): Promise<LatLng | null> => {
      try { const r = await withTimeout(AppleSearch.search(q, region), 8000, [] as AppleResult[]); return r[0] ? { latitude: r[0].latitude, longitude: r[0].longitude } : null; } catch { return null; }
    };
    const full = address.trim(); const short = full.split(',')[0].trim();
    return (await trySearch(full)) ?? (short && short !== full ? await trySearch(short) : null);
  },
};

// Drains the App Group intents the Share popup queued, resolves the location (native-first, JS fallback), and
// publishes {location, action} to the Location screen. Runs on cold launch, every foreground, and url events.
export function useSharedLocationIntake(): void {
  const busy = useRef(false);

  useEffect(() => {
    const process = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        for (;;) {
          const json = await SharedIntake.consumeSharedIntent();
          if (!json) break;
          let intent: Intent;
          try { intent = JSON.parse(json) as Intent; } catch { continue; }

          let loc: SharedLocation | null = null;
          if (intent.location) {
            const { lat, lng, name, source } = intent.location;
            loc = { coordinate: { latitude: lat, longitude: lng }, name, source };
          } else if (intent.raw) {
            loc = await parseSharedLocation(intent.raw, deps); // degraded fallback
          }
          if (loc) sharedLocationStore.set({ location: loc, action: intent.action });
        }
      } finally { busy.current = false; }
    };

    void process();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') void process(); });
    const linkSub = Linking.addEventListener('url', () => void process());
    return () => { sub.remove(); linkSub.remove(); };
  }, []);
}
```

- [ ] **Step 6: Rewire the Location screen — apply the action + mirror savedTripExists**

In `src/app/location.tsx`:

(a) Update the shared consume + effect. Replace the block currently at ~lines 178–199 (the `shared` state, its subscribe, `sharedCenterRef`/`centerOnShared`, and the shared→dropped-pin effect) with an action-applying version:

```tsx
  // An intent handed off from the share popup (resolved location + the chosen action). Consumed once on mount
  // and on every subsequent publish; applied as Navigate (start/extend trip) or Add to Trip.
  const [sharedIntent, setSharedIntent] = useState(() => sharedLocationStore.consume());
  useEffect(() => sharedLocationStore.subscribe(() => setSharedIntent(sharedLocationStore.consume())), []);
  useEffect(() => {
    if (!sharedIntent) return;
    const { location, action } = sharedIntent;
    const place: Place = {
      id: `pin:${location.coordinate.latitude.toFixed(5)},${location.coordinate.longitude.toFixed(5)}`,
      title: location.name ?? 'Shared Location',
      subtitle: '',
      coordinate: location.coordinate,
      kind: 'poi',
      source: 'apple',
    };
    setSelectedCharger(null);
    setTab('location');
    if (action === 'addToTrip') void trip.addToSaved(place);
    else onSelectPlace(place);
    setScreen('trip');
    setSharedIntent(null);
  }, [sharedIntent]);
```

(b) Mirror `savedTripExists` into the App Group whenever it changes (add near the other effects, after `trip` is defined):

```tsx
  // Let the Share popup know whether "Add to Trip" should be enabled (the trip lives in AsyncStorage, which the
  // extension can't read — so mirror the flag through the App Group).
  useEffect(() => {
    const name = trip.trip?.stops[trip.trip.stops.length - 1]?.title ?? null;
    void SharedIntake.setSavedTrip(trip.savedExists, name);
  }, [trip.savedExists, trip.trip]);
```

(c) Add the import at the top of `location.tsx` (with the other imports):

```tsx
import SharedIntake from '../../modules/shared-intake';
```

Remove the now-unused `centerOnShared`/`sharedCenterRef` references and the `onMapReady={centerOnShared}` wiring if present (the shared flow no longer drops a neutral pin; it goes straight to the Trip view). Leave the long-press/POI `droppedPin` code intact.

- [ ] **Step 7: Type-check + run the JS test suite**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: PASS.

Run: `npm test`
Expected: PASS (existing suite + the updated `sharedLocationStore.test.ts`).

- [ ] **Step 8: Commit**

```bash
git add src/state/sharedLocationStore.ts src/state/sharedLocationStore.test.ts src/hooks/useSharedLocationIntake.ts src/app/location.tsx
git commit -m "feat(share-popup): apply shared intent action + mirror savedTripExists"
```

---

## Task 6: Register files, native build, deploy, on-device verification

Wire the new Swift files into the extension target, build once, deploy, and verify end-to-end. This is the integration gate for Tasks 2 & 4 (which had no local test).

**Files:**
- Create: `ios/scripts/add_share_resolver_files.rb`

- [ ] **Step 1: Write the xcodeproj registration script**

Create `ios/scripts/add_share_resolver_files.rb` (adds the three new Swift files — including a **file reference** to the tracked SwiftPM source — to the ShareExtension target's compile sources; idempotent):

```ruby
require 'xcodeproj'

project = Xcodeproj::Project.open(File.expand_path('../airgapp.xcodeproj', __dir__))
target = project.targets.find { |t| t.name == 'ShareExtension' } or abort 'ShareExtension target not found'

files = {
  'SharedLocationResolver.swift' => File.expand_path('../ShareExtension/SharedLocationResolver.swift', __dir__),
  'SharePreviewView.swift'       => File.expand_path('../ShareExtension/SharePreviewView.swift', __dir__),
  # The pure core is tracked under modules/ and compiled into the extension by reference.
  'SharedLocationExtract.swift'  => File.expand_path('../../modules/shared-location-resolver/Sources/SharedLocationParsing/SharedLocationExtract.swift', __dir__),
}

group = project.main_group.find_subpath('ShareExtension', true)
files.each do |name, path|
  next if target.source_build_phase.files_references.any? { |r| r.real_path.to_s == path }
  ref = group.new_reference(path)
  target.add_file_references([ref])
  puts "added #{name}"
end

project.save
puts 'done'
```

- [ ] **Step 2: Run the registration script**

Run: `cd ios && ruby scripts/add_share_resolver_files.rb`
Expected: prints `added SharedLocationResolver.swift`, `added SharePreviewView.swift`, `added SharedLocationExtract.swift`, `done`. (Re-running prints only `done`.)

- [ ] **Step 3: Smoke-test the extension scheme compiles (fast signing/link check)**

Run:
```bash
xcodebuild -workspace ios/airgapp.xcworkspace -scheme ShareExtension -configuration Release \
  -sdk iphoneos -destination 'generic/platform=iOS' -allowProvisioningUpdates build 2>&1 | tail -5
```
Expected: `** BUILD SUCCEEDED **`. (If `ShareExtension` is not a shared scheme, build the `airgapp` scheme directly in Step 4.)

- [ ] **Step 4: Full Release build**

Run:
```bash
xcodebuild -workspace ios/airgapp.xcworkspace -scheme airgapp -configuration Release \
  -sdk iphoneos -destination 'generic/platform=iOS' -allowProvisioningUpdates build 2>&1 | tail -5
```
Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 5: Deploy JS + install the freshly built app**

Run: `bash scripts/godot-ios/deploy-js.sh`
Expected: ends with `App installed:` and `✓ done`.

- [ ] **Step 6: On-device end-to-end verification (manual checklist)**

Verify each and record the result:
- Share from **Apple Maps** → popup shows map + name + address; **Navigate** → open airgapp → Trip view to that place.
- Share from **Google Maps** (a place) → popup resolves (brief spinner) → shows map/name; **Add to Trip** → open airgapp → stop appended to the saved trip. (If no saved trip yet, **Add to Trip is disabled/dimmed**.)
- Share from **Google Maps** (a city name) → resolves via geocode → card populated.
- Share from **Waze** (`ll` and a `/ul/h` geohash link) → popup shows the correct pin.
- Share a **photo / a file** → airgapp does **not** appear in the share sheet (activation rule).
- Resolution-fail path: enable Airplane Mode, share a **goo.gl** link → card degrades to "Shared Location"/no map, tap a button → open airgapp → the JS raw-fallback resolves it (with network back) or shows nothing gracefully.

- [ ] **Step 7: Update memory**

Append the popup outcome to `~/.claude/projects/-Users-ivan-Work-airgapp-mobile/memory/shared-location-intake.md` (native popup, sole-resolver architecture, tracked SwiftPM parser + `swift test`, the future signed-send seam). No code commit for `ios/` (gitignored).

---

## Notes for the executor

- **Native tasks (2, 4) and the `ios/` script (6) are gitignored** — their acceptance is the on-device checklist in Task 6, not a git commit. Only Tasks 1, 3, 5 produce commits.
- **The JS parser (`services/sharedLocation.ts`) is intentionally retained** as the degraded raw-fallback (Task 5) until the native path is proven across the full Task-6 checklist; deleting it (and the fallback `deps`) is a follow-up once trusted, not part of this plan.
- **Do not `expo prebuild`.** File wiring is via the `xcodeproj` gem only.
- If `swift test` (Task 1) can't resolve a vector, fix the **port**, not the test — the JS vector is the source of truth.
