import SurfaceConsole
import SwiftUI

private let echoDefinition = SurfaceDefinition(
    id: "echo",
    name: "Echo",
    subtitle: "Growth and content operations from the exact Las surface boundary.",
    symbol: "waveform.and.magnifyingglass",
    accent: .purple,
    repositoryPath: "echo",
    privacyBoundary: "Echo reports contract presence and aggregate counts only. Account data, user content, generated media, raw logs, credentials, and captured artifacts are never rendered.",
    checks: [
        CheckSpec(id: "manifest", title: "Application manifest", detail: "Node package contract", relativePath: "package.json", kind: .file),
        CheckSpec(id: "mcp", title: "Las MCP surface", detail: "Read-only Echo agent entry point", relativePath: "agent/mcp.mjs", kind: .file),
        CheckSpec(id: "web", title: "Web application", detail: "Existing Next application surface", relativePath: "src/app", kind: .directory),
        CheckSpec(id: "deployment", title: "Deployment contract", detail: "Vercel deployment declaration", relativePath: "vercel.json", kind: .file),
        CheckSpec(id: "supabase", title: "Database contracts", detail: "Supabase schema directory", relativePath: "supabase", kind: .directory),
    ],
    aggregates: [
        AggregateSpec(id: "runs", title: "Operational workspaces", detail: "Opaque local workspace count", relativePath: ".work", mode: .immediateDirectories),
        AggregateSpec(id: "routes", title: "Application source files", detail: "Route/component source count", relativePath: "src/app", mode: .recursiveFiles, allowedExtensions: ["ts", "tsx"]),
        AggregateSpec(id: "migrations", title: "Database migrations", detail: "Declared migration count", relativePath: "supabase/migrations", mode: .immediateFiles, allowedExtensions: ["sql"]),
    ],
    environmentNames: ["NEXT_PUBLIC_SUPABASE_URL"]
)

@main
struct EchoDesktopApp: App {
    @StateObject private var model = SurfaceModel(definition: echoDefinition)

    var body: some Scene {
        WindowGroup("Echo") { SurfaceRootView(model: model) }
            .defaultSize(width: SurfaceTheme.minimumWidth, height: SurfaceTheme.minimumHeight)
            .windowResizability(.contentMinSize)
            .windowStyle(.titleBar)
            .windowToolbarStyle(.unified)
    }
}
