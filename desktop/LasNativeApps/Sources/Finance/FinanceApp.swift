import SurfaceConsole
import SwiftUI

private let financeDefinition = SurfaceDefinition(
    id: "finance",
    name: "Finance",
    subtitle: "Proposal-only financial reference monitor and policy posture.",
    symbol: "chart.line.text.clipboard",
    accent: .green,
    repositoryPath: "wisentbot",
    privacyBoundary: "Finance shows proposal-only surface readiness and aggregate policy metadata. It can never execute, approve, sign, broadcast, reveal beneficiaries, or render account and transaction details.",
    checks: [
        CheckSpec(id: "manifest", title: "Rust package", detail: "Wisentbot crate contract", relativePath: "Cargo.toml", kind: .file),
        CheckSpec(id: "entry", title: "Las MCP surface", detail: "Finance MCP entry point", relativePath: "bin/singularity-finance-mcp.rs", kind: .file),
        CheckSpec(id: "surface", title: "Finance surface", detail: "Proposal-only policy implementation", relativePath: "src/finance_surface", kind: .directory),
        CheckSpec(id: "binary", title: "Release monitor binary", detail: "Signed Las launch artifact", relativePath: "target/release/singularity-finance-mcp", kind: .executable),
        CheckSpec(id: "domain", title: "Domain contract", detail: "Shared immutable domain model", relativePath: "src/domain.rs", kind: .file),
    ],
    aggregates: [
        AggregateSpec(id: "surface-modules", title: "Finance modules", detail: "Proposal monitor source count", relativePath: "src/finance_surface", mode: .recursiveFiles, allowedExtensions: ["rs"]),
        AggregateSpec(id: "binaries", title: "MCP entry points", detail: "Declared Rust binary source count", relativePath: "bin", mode: .immediateFiles, allowedExtensions: ["rs"]),
        AggregateSpec(id: "documents", title: "Policy documentation", detail: "Repository documentation count", relativePath: "docs", mode: .recursiveFiles, allowedExtensions: ["md"]),
    ],
    environmentNames: [
        "SINGULARITY_FINANCE_POLICY_FILE",
        "SINGULARITY_FINANCE_ENABLE_LEASE_FILE",
        "SINGULARITY_FINANCE_STATE_DIR",
        "SINGULARITY_FINANCE_VERIFY_KEY_HEX",
        "SINGULARITY_FINANCE_BINARY_SHA256",
    ]
)

@main
struct FinanceDesktopApp: App {
    @StateObject private var model = SurfaceModel(definition: financeDefinition)

    var body: some Scene {
        WindowGroup("Finance") { SurfaceRootView(model: model) }
            .defaultSize(width: SurfaceTheme.minimumWidth, height: SurfaceTheme.minimumHeight)
            .windowResizability(.contentMinSize)
            .windowStyle(.titleBar)
            .windowToolbarStyle(.unified)
    }
}
