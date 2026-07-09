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
