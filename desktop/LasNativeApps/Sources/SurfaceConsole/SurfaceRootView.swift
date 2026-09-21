import AppKit
import SwiftUI
import WisentDesignSystem

public enum SurfaceTheme {
    public static let minimumWidth: CGFloat = 960
    public static let minimumHeight: CGFloat = 660

    static func accent(_ accent: SurfaceAccent) -> Color {
        switch accent {
        case .blue: Color(nsColor: .systemBlue)
        case .cyan: Color(nsColor: .systemCyan)
        case .green: Color(nsColor: .systemGreen)
        case .indigo: Color(nsColor: .systemIndigo)
        case .orange: Color(nsColor: .systemOrange)
        case .purple: Color(nsColor: .systemPurple)
        case .teal: Color(nsColor: .systemTeal)
        }
    }

    static let canvas = Color(nsColor: .windowBackgroundColor)
    static let surface = Color(nsColor: .controlBackgroundColor)
    static let border = Color(nsColor: .separatorColor)
    static let secondary = Color(nsColor: .secondaryLabelColor)
    static let muted = Color(nsColor: .tertiaryLabelColor)
    static let available = Color(nsColor: .systemGreen)
    static let unavailable = Color(nsColor: .systemOrange)
}

public struct SurfaceRootView: View {
    @ObservedObject var model: SurfaceModel
    @State private var destination: ConsoleDestination? = .overview

    public init(model: SurfaceModel) {
        self.model = model
    }

    public var body: some View {
        NavigationSplitView {
            List(ConsoleDestination.allCases, selection: $destination) { item in
                Label(item.title, systemImage: item.symbol)
                    .tag(item)
            }
            .navigationTitle(model.definition.name)
            .navigationSplitViewColumnWidth(min: 210, ideal: 225)
            .safeAreaInset(edge: .bottom) {
                sidebarStatus
            }
        } detail: {
            VStack(spacing: 0) {
                if let errorMessage = model.errorMessage {
                    errorBanner(errorMessage)
                        .padding(.horizontal, 20)
                        .padding(.top, 12)
                }
                Group {
                    if let snapshot = model.snapshot {
                        destinationView(snapshot)
                    } else if model.isRefreshing {
                        SurfaceReadingView(
                            name: model.definition.name,
                            destination: destination ?? .overview
                        )
                    } else {
                        ContentUnavailableView {
                            Label("Local surface unavailable", systemImage: "questionmark.folder")
                        } description: {
                            Text("Choose the Wisent workspace, then refresh the \(model.definition.name) surface.")
                        } actions: {
                            Button("Choose Workspace", action: chooseWorkspace)
                                .buttonStyle(.borderedProminent)
                        }
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            .background(SurfaceTheme.canvas)
        }
        .frame(minWidth: SurfaceTheme.minimumWidth, minHeight: SurfaceTheme.minimumHeight)
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button(action: chooseWorkspace) {
                    Label("Choose Workspace", systemImage: "folder")
                }
                Button {
                    Task { await model.refresh() }
                } label: {
                    // The glyph dims while the read is in flight instead of
                    // being replaced by a spinning circle: the control keeps
                    // its place, its icon and its name.
                    Label("Refresh", systemImage: "arrow.clockwise")
                        .opacity(model.isRefreshing ? 0.35 : 1)
                }
                .disabled(model.isRefreshing || model.workspaceRoot == nil)
                .keyboardShortcut("r", modifiers: .command)
            }
        }
        .task {
            if model.snapshot == nil, model.workspaceRoot != nil {
                await model.refresh()
            }
        }
    }

    @ViewBuilder
    private func destinationView(_ snapshot: SurfaceSnapshot) -> some View {
        switch destination ?? .overview {
        case .overview:
            overview(snapshot)
        case .contracts:
            contracts(snapshot)
        case .inventory:
            inventory(snapshot)
        case .configuration:
            configuration(snapshot)
        }
    }

    private func overview(_ snapshot: SurfaceSnapshot) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                header(snapshot)
                HStack(spacing: 12) {
                    MetricCard(
                        title: "Contracts",
                        value: "\(model.availableCheckCount)/\(snapshot.checks.count)",
                        detail: "Available locally",
                        symbol: "checkmark.shield",
                        accent: model.definition.accent
                    )
                    MetricCard(
                        title: "Safe inventory",
                        value: model.aggregateTotal.formatted(),
                        detail: "Aggregate entries",
                        symbol: "list.number",
                        accent: model.definition.accent
                    )
                    MetricCard(
                        title: "Configuration",
                        value: "\(snapshot.configuredEnvironmentCount)/\(snapshot.declaredEnvironmentCount)",
                        detail: "Declared variables present",
                        symbol: "gearshape.2",
                        accent: model.definition.accent
                    )
                }

                VStack(alignment: .leading, spacing: 12) {
                    Text("Surface readiness")
                        .font(.title3.weight(.semibold))
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 240), spacing: 12)], spacing: 12) {
                        ForEach(snapshot.checks.prefix(6)) { check in
                            ContractCard(check: check, accent: model.definition.accent)
                        }
                    }
                }
                PrivacyBoundary(definition: model.definition)
            }
            .padding(24)
        }
        .navigationTitle("Overview")
    }

    private func header(_ snapshot: SurfaceSnapshot) -> some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 4) {
                Label(model.definition.name, systemImage: model.definition.symbol)
                    .font(.largeTitle.weight(.semibold))
                    .foregroundStyle(SurfaceTheme.accent(model.definition.accent))
                Text(model.definition.subtitle)
                    .font(.subheadline)
                    .foregroundStyle(SurfaceTheme.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                Text("Updated")
                    .font(.caption)
                    .foregroundStyle(SurfaceTheme.secondary)
                Text(snapshot.loadedAt, style: .relative)
                    .font(.caption.weight(.semibold))
            }
        }
    }

    func sectionHeader(_ title: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.largeTitle.weight(.semibold))
            Text(detail)
                .font(.subheadline)
                .foregroundStyle(SurfaceTheme.secondary)
        }
    }

    private var sidebarStatus: some View {
        VStack(alignment: .leading, spacing: 8) {
            Divider()
            Label("Las surface", systemImage: "leaf.fill")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(SurfaceTheme.accent(model.definition.accent))
            Text(model.definition.id)
                .font(.caption.monospaced())
                .foregroundStyle(SurfaceTheme.secondary)
            Text("Metadata only")
                .font(.caption2)
                .foregroundStyle(SurfaceTheme.muted)
        }
        .padding(16)
        .background(.bar)
        .accessibilityElement(children: .combine)
    }

    private func errorBanner(_ message: String) -> some View {
        Label(message, systemImage: "exclamationmark.triangle.fill")
            .font(.caption)
            .foregroundStyle(SurfaceTheme.unavailable)
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(SurfaceTheme.unavailable.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
    }

    private func chooseWorkspace() {
        let panel = NSOpenPanel()
        panel.title = "Choose the Wisent workspace"
        panel.prompt = "Choose"
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.directoryURL = model.workspaceRoot
        if panel.runModal() == .OK, let url = panel.url {
            model.selectWorkspace(url)
        }
    }
}
