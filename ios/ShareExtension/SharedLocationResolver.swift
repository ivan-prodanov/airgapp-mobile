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
    let short = SharedLocationExtract.isShortLink(url)

    // 1) Direct sync extraction.
    if let ex = SharedLocationExtract.extract(fromUrl: url), let c = ex.coordinate {
      return enrichAddress(ex, c, completion)
    }

    // 2) Short link → resolve, re-extract over final URL + body.
    if short {
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

  // Geocode a name-only share. MKLocalSearch often can't resolve the full messy address blob (a Google share's
  // "Name, Street, City, ZIP, Country"), so mirror the JS parser: try the full string, then just the leading
  // segment (the place name). Without this fallback, most named Google shares fail with MKError placemarkNotFound.
  private static func geocodeFallback(_ ex: RawExtract?, _ completion: @escaping (ResolvedLocation?) -> Void) {
    guard let address = ex?.address, !address.isEmpty else { return completion(nil) }
    let full = address.trimmingCharacters(in: .whitespaces)
    let short = full.split(separator: ",").first.map { $0.trimmingCharacters(in: .whitespaces) } ?? full
    searchLocal(full, ex) { r in
      if let r = r { return completion(r) }
      if short != full && !short.isEmpty { searchLocal(short, ex, completion) } else { completion(nil) }
    }
  }

  private static func searchLocal(_ query: String, _ ex: RawExtract?, _ completion: @escaping (ResolvedLocation?) -> Void) {
    let req = MKLocalSearch.Request()
    req.naturalLanguageQuery = query
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

  // Read the 302's Location header instead of FOLLOWING it.
  //
  // The short link answers with a clean `302 → https://maps.google.com?q=<lat>,<lng>` — the
  // coordinates are already in that header, so the ~800 KB maps page we used to download was never
  // needed to learn where the place is. Following the redirect is also where this broke: the page
  // request intermittently returned a non-redirecting interstitial, leaving finalUrl on the
  // short-link host with no coordinates anywhere. Measured on-car 2026-07-27, four of six shares
  // resolved to nil and queued NOTHING — and one of those was the same link that had worked
  // twenty-two seconds earlier, which is what "some shares work, some don't" actually was.
  //
  // Not fetching the page removes the interstitial from the path entirely, and drops an 800 KB
  // download in a memory-capped extension to a single header read.
  //
  // The old follow-and-scrape path stays as the fallback for links whose first hop is not a
  // redirect at all, and it keeps its retry.
  private static func fetch(_ url: String, attempts: Int = 3, _ completion: @escaping (String?, String?) -> Void) {
    guard let u = URL(string: url) else { return completion(nil, nil) }
    let catcher = RedirectCatcher()
    let session = URLSession(configuration: cleanConfig(), delegate: catcher, delegateQueue: nil)
    session.dataTask(with: request(u)) { _, _, _ in
      session.finishTasksAndInvalidate()
      // A redirect that still points at the short-link host has not told us anything yet.
      if let loc = catcher.location, !SharedLocationExtract.isShortLink(loc) {
        return completion(loc, nil)
      }
      ShareTrace.trace("fetch: no usable 302 (loc=\(catcher.location ?? "none")) → following instead")
      followAndScrape(url, attempts: attempts, completion)
    }.resume()
  }

  // The original path: follow every redirect and hand back the final URL plus the page body.
  private static func followAndScrape(_ url: String, attempts: Int, _ completion: @escaping (String?, String?) -> Void) {
    guard let u = URL(string: url) else { return completion(nil, nil) }
    let session = URLSession(configuration: cleanConfig())
    session.dataTask(with: request(u)) { data, resp, _ in
      session.finishTasksAndInvalidate()
      let finalUrl = resp?.url?.absoluteString
      let body = data.flatMap { String(data: $0, encoding: .utf8) }
      // Redirect didn't land (finalUrl still on the short-link host) → retry with a fresh session.
      if attempts > 1, let f = finalUrl, SharedLocationExtract.isShortLink(f) {
        return followAndScrape(url, attempts: attempts - 1, completion)
      }
      if let f = finalUrl, SharedLocationExtract.isShortLink(f) {
        ShareTrace.trace("fetch: gave up on \(url) — still on the short host after \(attempts) tries")
      }
      completion(finalUrl, body)
    }.resume()
  }

  // A CLEAN ephemeral session every time — no shared cookie store or cache to poison the consent
  // redirect, which is what made this fail differently on consecutive shares of the same link.
  private static func cleanConfig() -> URLSessionConfiguration {
    let config = URLSessionConfiguration.ephemeral
    config.httpCookieStorage = nil
    config.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
    return config
  }

  private static func request(_ u: URL) -> URLRequest {
    var req = URLRequest(url: u, timeoutInterval: timeout)
    req.setValue("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", forHTTPHeaderField: "User-Agent")
    req.setValue("CONSENT=YES+cb; SOCS=CAISNQgDEitib3E", forHTTPHeaderField: "Cookie")
    req.httpShouldHandleCookies = false
    return req
  }

  private static func postalString(_ p: CLPlacemark) -> String? {
    let parts = [p.subThoroughfare, p.thoroughfare, p.locality, p.administrativeArea].compactMap { $0 }
    return parts.isEmpty ? nil : parts.joined(separator: " ")
  }
}

// Captures a redirect's target WITHOUT following it. completionHandler(nil) stops the chain, so the
// task finishes on the 302 itself and the ~800 KB page is never fetched.
private final class RedirectCatcher: NSObject, URLSessionTaskDelegate {
  var location: String?

  func urlSession(_ session: URLSession, task: URLSessionTask,
                  willPerformHTTPRedirection response: HTTPURLResponse,
                  newRequest request: URLRequest,
                  completionHandler: @escaping (URLRequest?) -> Void) {
    // First hop only: that is the one carrying ?q=<lat>,<lng>.
    if location == nil { location = request.url?.absoluteString }
    completionHandler(nil)
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
