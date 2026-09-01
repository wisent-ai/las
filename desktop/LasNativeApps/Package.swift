// swift-tools-version: 6.0
import PackageDescription

let products = ["Echo", "Most", "Probierz", "Brama", "Warsztat", "Finance", "Byk"]

let package = Package(
    name: "LasNativeApps",
    platforms: [.macOS(.v14)],
    products: products.map { .executable(name: $0, targets: [$0]) },
    dependencies: [
        // The shared skeleton/design vocabulary, linked instead of copied.
        .package(url: "https://github.com/wisent-ai/wisent-components.git", exact: "0.8.1"),
    ],
    targets: [
        .target(
            name: "SurfaceConsole",
            dependencies: [.product(name: "WisentDesignSystem", package: "wisent-components")]
        ),
    ] + products.map {
        .executableTarget(name: $0, dependencies: ["SurfaceConsole"])
    }
)
