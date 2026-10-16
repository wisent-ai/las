import SurfaceConsole
import SwiftUI

private let probierzDefinition = SurfaceDefinition(
    id: "probierz",
    name: "Probierz",
    subtitle: "Cross-platform verification source contracts and artifact inventory.",
    symbol: "checkmark.seal",
    accent: .orange,
    repositoryPath: "probierz",
    privacyBoundary: "Probierz reports configuration and artifact counts only. It never starts a suite automatically and never renders screenshots, traces, videos, OTP material, or application credentials.",
    checks: [
        CheckSpec(id: "manifest", title: "Rust package", detail: "Probierz package contract", relativePath: "probierz-rs/Cargo.toml", kind: .file),
        CheckSpec(id: "mcp", title: "Las MCP source", detail: "Source presence for probierz mcp, not a live handshake", relativePath: "probierz-rs/src/mcp", kind: .directory),
        CheckSpec(id: "apps", title: "Application surfaces", detail: "Configured test surfaces", relativePath: "apps", kind: .directory),
        CheckSpec(id: "results", title: "Result store", detail: "Local result metadata directory", relativePath: "test-results", kind: .directory),
        CheckSpec(id: "config", title: "Release declaration", detail: "Declared delivery contract, not installed runtime evidence", relativePath: ".wisent-release.json", kind: .file),
    ],
    aggregates: [
        AggregateSpec(id: "surfaces", title: "Configured surfaces", detail: "Application directory count", relativePath: "apps", mode: .immediateDirectories),
        AggregateSpec(id: "surface-configs", title: "Surface specifications", detail: "Probierz YAML contract count", relativePath: "apps", mode: .recursiveFiles, allowedExtensions: ["yaml", "yml"]),
        AggregateSpec(id: "artifacts", title: "Recorded result artifacts", detail: "Metadata-only artifact count", relativePath: "test-results", mode: .recursiveFiles, allowedExtensions: ["json", "zip", "webm", "png"]),
    ],
    environmentNames: [
        "ANDROID_HOME", "ANDROID_SDK_ROOT", "APPIUM_HOME", "APP_IOS", "BUNDLE_ID",
        "IOS_DEVICE", "IOS_VERSION", "PLAYWRIGHT_BROWSERS_PATH",
    ]
)

@main
struct ProbierzDesktopApp: App {
    @StateObject private var model = SurfaceModel(definition: probierzDefinition)

    var body: some Scene {
        WindowGroup("Probierz") { SurfaceRootView(model: model) }
            .defaultSize(width: SurfaceTheme.minimumWidth, height: SurfaceTheme.minimumHeight)
            .windowResizability(.contentMinSize)
            .windowStyle(.titleBar)
            .windowToolbarStyle(.unified)
    }
}
