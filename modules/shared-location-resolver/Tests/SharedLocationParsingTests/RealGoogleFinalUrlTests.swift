import XCTest
@testable import SharedLocationParsing

// The two final URLs a Google Maps short link ACTUALLY redirects to, captured
// with curl on 2026-07-27 from links that failed to resolve on the device.
final class RealGoogleFinalUrlTests: XCTestCase {
  func testCoordinateForm() {
    let url = "https://www.google.com/maps?q=39.9798948,25.4012835&entry=gps&shh=CAE&lucs=,94297699&g_ep=CAIS&ucbcb=1"
    let ex = SharedLocationExtract.extract(fromUrl: url)
    XCTAssertNotNil(ex?.coordinate, "q=lat,lng must yield a coordinate")
    XCTAssertEqual(ex?.coordinate?.latitude ?? 0, 39.9798948, accuracy: 1e-6)
  }
  func testNamedPlaceForm() {
    let url = "https://www.google.com/maps?q=%CE%A4%CE%BF%CF%80%CE%B9%CE%BA%CE%AE+%CE%9A%CE%BF%CE%B9%CE%BD%CF%8C%CF%84%CE%B7%CF%84%CE%B1+%CE%9A%CE%B1%CE%BB%CE%BB%CE%B9%CF%8C%CF%80%CE%B7%CF%82,+Greece&ftid=0x14afec0b403876bb:0x62c1878795457e97&entry=gps"
    let ex = SharedLocationExtract.extract(fromUrl: url)
    XCTAssertNil(ex?.coordinate, "no coordinate in this form")
    XCTAssertNotNil(ex?.address ?? ex?.name, "but the place NAME must survive for geocoding")
    print("NAMED → name=\(ex?.name ?? "nil") address=\(ex?.address ?? "nil")")
  }
}

extension RealGoogleFinalUrlTests {
  // The Location header of the FIRST hop — no path, host maps.google.com. This is
  // the form the fix reads, so it has to parse or the fix is worthless.
  func testFirstHopLocationHeaderForm() {
    let loc = "https://maps.google.com?q=39.9509632,25.3980108&entry=gps&shh=CAE&skid=143f8e16"
    let ex = SharedLocationExtract.extract(fromUrl: loc)
    XCTAssertNotNil(ex?.coordinate, "the 302 Location must yield a coordinate")
    XCTAssertEqual(ex?.coordinate?.latitude ?? 0, 39.9509632, accuracy: 1e-6)
    XCTAssertEqual(ex?.coordinate?.longitude ?? 0, 25.3980108, accuracy: 1e-6)
  }
}
