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
  // Regression: `queryValue` must replace `+`→space on the STILL-ENCODED value before percent-decoding,
  // so an escaped literal `+` (%2B) survives — matching `new URL(...).searchParams.get("q")` on the same URL.
  func testQueryValueEscapedPlusSurvives() {
    let r = SharedLocationExtract.extract(fromUrl: "https://maps.apple.com/?q=T%2BMobile")
    XCTAssertEqual(r?.name, "T+Mobile")
  }
  // Regression: SHORT_LINK_RE has the JS `/i` flag; an uppercase scheme must still match.
  func testIsShortLinkCaseInsensitiveScheme() {
    XCTAssertTrue(SharedLocationExtract.isShortLink("HTTPS://maps.app.goo.gl/x"))
  }
  // Regression: JS `URL.hostname` is lowercased; an uppercase host must still resolve to a known source
  // instead of falling through to `.unknown` (which would make `extract` return nil).
  func testUppercaseHostStillResolves() {
    let r = SharedLocationExtract.extract(fromUrl: "https://WWW.GOOGLE.COM/maps/@52.520008,13.404954,15z")
    XCTAssertEqual(r?.source, .google)
    XCTAssertNotNil(r?.coordinate)
    near(r!.coordinate!.latitude, 52.520008); near(r!.coordinate!.longitude, 13.404954)
  }
  func testFirstUrlFromText() {
    XCTAssertEqual(SharedLocationExtract.firstUrl(in: "Colosseum\nhttps://maps.apple.com/?ll=41.89,12.49&q=Colosseum"),
                   "https://maps.apple.com/?ll=41.89,12.49&q=Colosseum")
  }
}
