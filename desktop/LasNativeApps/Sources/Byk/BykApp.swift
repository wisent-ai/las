import SurfaceConsole
import SwiftUI

private let bykDefinition = SurfaceDefinition(
    id: "byk",
    name: "Byk",
    subtitle: "Read-only founder strategy posture from the Oko/Światowid surface.",
    symbol: "scope",
    accent: .indigo,
    repositoryPath: "swiatowid",
    privacyBoundary: "Byk reports strategy contract readiness and aggregate model counts only. Goals, roster identities, raw transcripts, messages, and confidential company context are never rendered by this desktop boundary.",
    checks: [
        CheckSpec(id: "manifest", title: "Swift package", detail: "Oko/Światowid package contract", relativePath: "Package.swift", kind: .file),
        CheckSpec(id: "mcp", title: "Las MCP surface", detail: "Read-only founder strategy entry point", relativePath: "Sources/oko-mcp", kind: .directory),
        CheckSpec(id: "goals", title: "Goal contracts", detail: "Auto-goal and intent model implementation", relativePath: "Sources/OkoKit/Goals", kind: .directory),
        CheckSpec(id: "telemetry", title: "Velocity contracts", detail: "Work telemetry and forecast implementation", relativePath: "Sources/OkoKit/Telemetry", kind: .directory),
        CheckSpec(id: "binary", title: "Strategy MCP binary", detail: "Local Las launch artifact", relativePath: ".build/debug/oko-mcp", kind: .executable),
    ],
    aggregates: [
        AggregateSpec(id: "goal-modules", title: "Goal model modules", detail: "Goal source count", relativePath: "Sources/OkoKit/Goals", mode: .recursiveFiles, allowedExtensions: ["swift"]),
        AggregateSpec(id: "telemetry-modules", title: "Velocity modules", detail: "Telemetry source count", relativePath: "Sources/OkoKit/Telemetry", mode: .recursiveFiles, allowedExtensions: ["swift"]),
        AggregateSpec(id: "mcp-modules", title: "Strategy MCP modules", detail: "Read-only surface source count", relativePath: "Sources/oko-mcp", mode: .recursiveFiles, allowedExtensions: ["swift"]),
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
