import SurfaceConsole
import SwiftUI

private let bykDefinition = SurfaceDefinition(
    id: "byk",
    name: "Byk",
    subtitle: "Local source and artifact posture for Oko's read-only founder strategy surface.",
    symbol: "scope",
    accent: .indigo,
    repositoryPath: "oko",
    privacyBoundary: "Byk reports strategy contract readiness and aggregate model counts only. Goals, roster identities, raw transcripts, messages, and confidential company context are never rendered by this desktop boundary.",
    checks: [
        CheckSpec(id: "manifest", title: "Rust package", detail: "Oko executable package contract", relativePath: "rust/Cargo.toml", kind: .file),
        CheckSpec(id: "mcp", title: "MCP source", detail: "Read-only founder strategy implementation; presence does not prove a handshake", relativePath: "rust/src/mcp", kind: .directory),
        CheckSpec(id: "goals", title: "Goal contracts", detail: "Auto-goal and intent model implementation", relativePath: "rust/src/goals", kind: .directory),
        CheckSpec(id: "telemetry", title: "Velocity contracts", detail: "Work telemetry and forecast implementation", relativePath: "rust/src/telemetry", kind: .directory),
        CheckSpec(id: "binary", title: "Oko executable", detail: "Local artifact presence, not runtime qualification", relativePath: "rust/target/debug/oko", kind: .executable),
    ],
    aggregates: [
        AggregateSpec(id: "goal-modules", title: "Goal model modules", detail: "Goal source count", relativePath: "rust/src/goals", mode: .recursiveFiles, allowedExtensions: ["rs"]),
        AggregateSpec(id: "telemetry-modules", title: "Velocity modules", detail: "Telemetry source count", relativePath: "rust/src/telemetry", mode: .recursiveFiles, allowedExtensions: ["rs"]),
        AggregateSpec(id: "mcp-modules", title: "Strategy MCP modules", detail: "Read-only surface source count", relativePath: "rust/src/mcp", mode: .recursiveFiles, allowedExtensions: ["rs"]),
    ],
    environmentNames: []
)

@main
struct BykDesktopApp: App {
    @StateObject private var model = SurfaceModel(definition: bykDefinition)

    var body: some Scene {
        WindowGroup("Byk") { SurfaceRootView(model: model) }
            .defaultSize(width: SurfaceTheme.minimumWidth, height: SurfaceTheme.minimumHeight)
            .windowResizability(.contentMinSize)
            .windowStyle(.titleBar)
            .windowToolbarStyle(.unified)
    }
}
