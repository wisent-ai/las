import SurfaceConsole
import SwiftUI

private let bramaDefinition = SurfaceDefinition(
    id: "brama",
    name: "Brama",
    subtitle: "Multi-provider model gateway readiness and contract inventory.",
    symbol: "rectangle.portrait.and.arrow.right",
    accent: .blue,
    repositoryPath: "brama",
    privacyBoundary: "Brama reports binary, provider, gateway, and migration metadata only. API keys, bearer tokens, prompt bodies, model responses, journals, and encrypted capability material are never rendered.",
    checks: [
        CheckSpec(id: "manifest", title: "Rust package", detail: "Brama crate contract", relativePath: "Cargo.toml", kind: .file),
        CheckSpec(id: "mcp", title: "Las MCP surface", detail: "Read-only gateway MCP implementation", relativePath: "src/mcp", kind: .directory),
        CheckSpec(id: "gateway", title: "Gateway implementation", detail: "Provider routing contract", relativePath: "src/gateway", kind: .directory),
        CheckSpec(id: "debug-bin", title: "Debug gateway binary", detail: "Local Las launch artifact", relativePath: "target/debug/brama", kind: .executable),
        CheckSpec(id: "migrations", title: "Journal schema", detail: "Gateway persistence migrations", relativePath: "migrations", kind: .directory),
    ],
    aggregates: [
        AggregateSpec(id: "gateway-modules", title: "Gateway modules", detail: "Rust module count", relativePath: "src/gateway", mode: .recursiveFiles, allowedExtensions: ["rs"]),
        AggregateSpec(id: "provider-contracts", title: "Provider contracts", detail: "Provider-related Rust source count", relativePath: "src", mode: .immediateFiles, allowedExtensions: ["rs"]),
        AggregateSpec(id: "migrations", title: "Database migrations", detail: "Declared migration count", relativePath: "migrations", mode: .immediateFiles, allowedExtensions: ["sql"]),
    ],
    environmentNames: []
)

@main
struct BramaDesktopApp: App {
    @StateObject private var model = SurfaceModel(definition: bramaDefinition)

    var body: some Scene {
        WindowGroup("Brama") { SurfaceRootView(model: model) }
            .defaultSize(width: SurfaceTheme.minimumWidth, height: SurfaceTheme.minimumHeight)
            .windowResizability(.contentMinSize)
            .windowStyle(.titleBar)
            .windowToolbarStyle(.unified)
    }
}
