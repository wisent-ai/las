import SurfaceConsole
import SwiftUI

private let mostDefinition = SurfaceDefinition(
    id: "most",
    name: "Most",
    subtitle: "Communications bridge readiness without message or recipient access.",
    symbol: "point.3.connected.trianglepath.dotted",
    accent: .cyan,
    repositoryPath: "most",
    privacyBoundary: "Most exposes service contracts and aggregate transport readiness only. Message bodies, recipient addresses, attachments, signing secrets, and conversation storage are never read into the UI.",
    checks: [
        CheckSpec(id: "manifest", title: "Python package", detail: "Most package contract", relativePath: "pyproject.toml", kind: .file),
        CheckSpec(id: "mcp", title: "Las MCP surface", detail: "Read-only health and diagnostics server", relativePath: "most_agent/mcp_server.py", kind: .file),
        CheckSpec(id: "api", title: "Service API", detail: "Most application entry point", relativePath: "app/main.py", kind: .file),
        CheckSpec(id: "backends", title: "Transport backends", detail: "Configured backend implementations", relativePath: "backends", kind: .directory),
        CheckSpec(id: "deployment", title: "Container deployment", detail: "Service composition contract", relativePath: "docker-compose.yml", kind: .file),
    ],
    aggregates: [
        AggregateSpec(id: "transports", title: "Transport families", detail: "Backend directory count", relativePath: "backends", mode: .immediateDirectories),
        AggregateSpec(id: "api-routes", title: "API router modules", detail: "Declared route module count", relativePath: "app/routers", mode: .immediateFiles, allowedExtensions: ["py"]),
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
