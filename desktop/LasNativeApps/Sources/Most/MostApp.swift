import SurfaceConsole
import SwiftUI

private let mostDefinition = SurfaceDefinition(
    id: "most",
    name: "Most",
    subtitle: "Communications bridge source contracts without message or recipient access.",
    symbol: "point.3.connected.trianglepath.dotted",
    accent: .cyan,
    repositoryPath: "most",
    privacyBoundary: "Most exposes service contracts and aggregate transport readiness only. Message bodies, recipient addresses, attachments, signing secrets, and conversation storage are never read into the UI.",
    checks: [
        CheckSpec(id: "manifest", title: "Rust service package", detail: "Most server package contract", relativePath: "most-rs/crates/most-server/Cargo.toml", kind: .file),
        CheckSpec(id: "mcp", title: "Las MCP source", detail: "Source presence, not a live MCP handshake", relativePath: "most-rs/crates/most-agent/src/bin/most-mcp.rs", kind: .file),
        CheckSpec(id: "api", title: "Service API", detail: "Most Rust application entry point", relativePath: "most-rs/crates/most-server/src/main.rs", kind: .file),
        CheckSpec(id: "backends", title: "Transport backends", detail: "Configured backend implementations", relativePath: "backends", kind: .directory),
        CheckSpec(id: "deployment", title: "Release declaration", detail: "Declared delivery contract, not installed runtime evidence", relativePath: ".wisent-release.json", kind: .file),
    ],
    aggregates: [
        AggregateSpec(id: "transports", title: "Transport families", detail: "Backend directory count", relativePath: "backends", mode: .immediateDirectories),
        AggregateSpec(id: "api-routes", title: "API router modules", detail: "Rust route source count", relativePath: "most-rs/crates/most-server/src/routes", mode: .recursiveFiles, allowedExtensions: ["rs"]),
        AggregateSpec(id: "migrations", title: "Storage migrations", detail: "Declared schema migration count", relativePath: "migrations", mode: .immediateFiles, allowedExtensions: ["sql"]),
    ],
    environmentNames: ["MOST_BASE_URL"]
)

@main
struct MostDesktopApp: App {
    @StateObject private var model = SurfaceModel(definition: mostDefinition)

    var body: some Scene {
        WindowGroup("Most") { SurfaceRootView(model: model) }
            .defaultSize(width: SurfaceTheme.minimumWidth, height: SurfaceTheme.minimumHeight)
            .windowResizability(.contentMinSize)
            .windowStyle(.titleBar)
            .windowToolbarStyle(.unified)
    }
}
