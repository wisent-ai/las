import SurfaceConsole
import SwiftUI

private let warsztatDefinition = SurfaceDefinition(
    id: "warsztat",
    name: "Warsztat",
    subtitle: "Policy-gated repository proposal workspace visibility.",
    symbol: "hammer",
    accent: .teal,
    repositoryPath: "wisentbot",
    privacyBoundary: "Warsztat exposes proposal contract readiness and aggregate policy metadata only. It never merges, deploys, restarts, publishes automatically, or renders repository secrets and patch contents.",
    checks: [
        CheckSpec(id: "manifest", title: "Rust package", detail: "Wisentbot crate contract", relativePath: "Cargo.toml", kind: .file),
        CheckSpec(id: "entry", title: "Las MCP surface", detail: "Repository proposal MCP entry point", relativePath: "bin/singularity-repo-mcp.rs", kind: .file),
        CheckSpec(id: "surface", title: "Proposal surface", detail: "Policy-gated repository implementation", relativePath: "src/repo_surface", kind: .directory),
        CheckSpec(id: "binary", title: "Workspace binary", detail: "Local Las launch artifact", relativePath: "target/debug/singularity-repo-mcp", kind: .executable),
        CheckSpec(id: "capabilities", title: "Capability deployment", detail: "Declared capability contracts", relativePath: "deploy/capabilities", kind: .directory),
    ],
    aggregates: [
        AggregateSpec(id: "surface-modules", title: "Proposal modules", detail: "Repository surface source count", relativePath: "src/repo_surface", mode: .recursiveFiles, allowedExtensions: ["rs"]),
        AggregateSpec(id: "capabilities", title: "Capability contracts", detail: "Deployment capability file count", relativePath: "deploy/capabilities", mode: .recursiveFiles, allowedExtensions: ["json", "toml", "yaml", "yml"]),
        AggregateSpec(id: "binaries", title: "MCP entry points", detail: "Declared Rust binary source count", relativePath: "bin", mode: .immediateFiles, allowedExtensions: ["rs"]),
    ],
    environmentNames: ["LAS_ONLY", "LAS_SKIP"]
)

@main
struct WarsztatDesktopApp: App {
    @StateObject private var model = SurfaceModel(definition: warsztatDefinition)

    var body: some Scene {
        WindowGroup("Warsztat") { SurfaceRootView(model: model) }
            .defaultSize(width: SurfaceTheme.minimumWidth, height: SurfaceTheme.minimumHeight)
            .windowResizability(.contentMinSize)
            .windowStyle(.titleBar)
            .windowToolbarStyle(.unified)
    }
}
