import ExpoModulesCore
import MapKit

// Builds an MKCoordinateRegion from the JS { latitude, longitude, latitudeDelta, longitudeDelta }.
private func makeRegion(_ r: [String: Double]) -> MKCoordinateRegion {
  let center = CLLocationCoordinate2D(latitude: r["latitude"] ?? 0, longitude: r["longitude"] ?? 0)
  let span = MKCoordinateSpan(latitudeDelta: r["latitudeDelta"] ?? 1, longitudeDelta: r["longitudeDelta"] ?? 1)
  return MKCoordinateRegion(center: center, span: span)
}

// Extract an MKPolyline's coordinates as [{ latitude, longitude }].
private func polyPoints(_ polyline: MKPolyline) -> [[String: Double]] {
  let count = polyline.pointCount
  var buf = [CLLocationCoordinate2D](repeating: CLLocationCoordinate2D(), count: count)
  polyline.getCoordinates(&buf, range: NSRange(location: 0, length: count))
  return buf.map { ["latitude": $0.latitude, "longitude": $0.longitude] }
}

// One-shot wrapper around MKLocalSearchCompleter (which streams updates via its delegate). Retains
// itself until the first results/error callback, then resolves the promise and releases.
private final class CompleterBox: NSObject, MKLocalSearchCompleterDelegate {
  private let completer = MKLocalSearchCompleter()
  private let promise: Promise
  private var done = false
  private var selfRef: CompleterBox?

  init(promise: Promise) {
    self.promise = promise
    super.init()
    completer.delegate = self
    completer.resultTypes = [.address, .pointOfInterest]
  }

  func run(query: String, region: MKCoordinateRegion) {
    selfRef = self // keep alive across the async delegate callback
    completer.region = region
    completer.queryFragment = query
  }

  private func finish(_ payload: [[String: String]]) {
    if done { return }
    done = true
    promise.resolve(payload)
    selfRef = nil
  }

  func completerDidUpdateResults(_ completer: MKLocalSearchCompleter) {
    finish(completer.results.map { ["title": $0.title, "subtitle": $0.subtitle] })
  }

  func completer(_ completer: MKLocalSearchCompleter, didFailWithError error: Error) {
    if done { return }
    done = true
    promise.reject("APPLE_SEARCH_COMPLETE", error.localizedDescription)
    selfRef = nil
  }
}

public class AppleSearchModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AppleSearch")

    AsyncFunction("complete") { (query: String, region: [String: Double], promise: Promise) in
      DispatchQueue.main.async {
        let box = CompleterBox(promise: promise)
        box.run(query: query, region: makeRegion(region))
      }
    }

    AsyncFunction("search") { (query: String, region: [String: Double], promise: Promise) in
      let request = MKLocalSearch.Request()
      request.naturalLanguageQuery = query
      request.region = makeRegion(region)
      MKLocalSearch(request: request).start { response, error in
        if let error = error {
          promise.reject("APPLE_SEARCH_SEARCH", error.localizedDescription)
          return
        }
        let items = (response?.mapItems ?? []).map { item -> [String: Any] in
          let c = item.placemark.coordinate
          return [
            "title": item.name ?? "",
            "subtitle": item.placemark.title ?? "",
            "latitude": c.latitude,
            "longitude": c.longitude,
          ]
        }
        promise.resolve(items)
      }
    }

    AsyncFunction("route") { (coords: [[String: Double]], promise: Promise) in
      DispatchQueue.main.async {
        func point(_ c: [String: Double]) -> MKMapItem {
          MKMapItem(placemark: MKPlacemark(coordinate: CLLocationCoordinate2D(latitude: c["latitude"] ?? 0, longitude: c["longitude"] ?? 0)))
        }
        if coords.count < 2 {
          promise.resolve(["polyline": [], "legs": [], "totalDistanceM": 0, "totalDurationS": 0])
          return
        }
        var polyline: [[String: Double]] = []
        var legs: [[String: Double]] = []
        var totalDistanceM = 0.0
        var totalDurationS = 0.0
        func step(_ i: Int) {
          if i >= coords.count - 1 {
            promise.resolve([
              "polyline": polyline, "legs": legs,
              "totalDistanceM": totalDistanceM, "totalDurationS": totalDurationS,
            ])
            return
          }
          let req = MKDirections.Request()
          req.source = point(coords[i])
          req.destination = point(coords[i + 1])
          req.transportType = .automobile
          MKDirections(request: req).calculate { resp, err in
            guard let r = resp?.routes.first else {
              promise.reject("APPLE_ROUTE", err?.localizedDescription ?? "no route")
              return
            }
            polyline.append(contentsOf: polyPoints(r.polyline))
            legs.append(["distanceM": r.distance, "durationS": r.expectedTravelTime])
            totalDistanceM += r.distance
            totalDurationS += r.expectedTravelTime
            step(i + 1)
          }
        }
        step(0)
      }
    }
  }
}
