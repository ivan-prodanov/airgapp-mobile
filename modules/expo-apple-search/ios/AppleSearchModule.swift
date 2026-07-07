import ExpoModulesCore
import MapKit

// Builds an MKCoordinateRegion from the JS { latitude, longitude, latitudeDelta, longitudeDelta }.
private func makeRegion(_ r: [String: Double]) -> MKCoordinateRegion {
  let center = CLLocationCoordinate2D(latitude: r["latitude"] ?? 0, longitude: r["longitude"] ?? 0)
  let span = MKCoordinateSpan(latitudeDelta: r["latitudeDelta"] ?? 1, longitudeDelta: r["longitudeDelta"] ?? 1)
  return MKCoordinateRegion(center: center, span: span)
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
  }
}
