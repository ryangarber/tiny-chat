// swift-tools-version: 6.4

import PackageDescription

// The desktop app's Apple Foundation Models host: afmize behind JSON lines on
// stdin and stdout, run by the app's main process (`AfmHostService.ts`).
let package = Package(
  name: "afmize-host",
  platforms: [.macOS(.v26)],
  dependencies: [
    .package(name: "afmize", path: "../../../vendor/afmize")
  ],
  targets: [
    .executableTarget(
      name: "afmize-host",
      dependencies: [.product(name: "afmize", package: "afmize")]
    )
  ]
)
