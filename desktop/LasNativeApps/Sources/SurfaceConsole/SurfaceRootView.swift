import AppKit
import SwiftUI

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

    /// A skeleton bar and the band that sweeps across it. Both come off the
    /// label colour, so they read the same way against the light and the dark
    /// canvas without a second palette.
    static let skeletonBar = Color(nsColor: .labelColor).opacity(0.10)
    static let skeletonSweep = Color(nsColor: .labelColor).opacity(0.20)
}

public struct SurfaceRootView: View {
    @ObservedObject private var model: SurfaceModel
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

    private func contracts(_ snapshot: SurfaceSnapshot) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                sectionHeader(
                    "Contracts",
                    detail: "Presence and executable checks for the exact Las surface implementation."
                )
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 280), spacing: 12)], spacing: 12) {
                    ForEach(snapshot.checks) { check in
                        ContractCard(check: check, accent: model.definition.accent)
                    }
                }
                PrivacyBoundary(definition: model.definition)
            }
            .padding(24)
        }
        .navigationTitle("Contracts")
    }

    private func inventory(_ snapshot: SurfaceSnapshot) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                sectionHeader(
                    "Safe inventory",
                    detail: "Counts only. File names and contents are not rendered."
                )
                if snapshot.aggregates.isEmpty {
                    ContentUnavailableView(
                        "No aggregate contracts",
                        systemImage: "tray",
                        description: Text("This surface does not declare a safe local inventory.")
                    )
                    .frame(minHeight: 340)
                } else {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 260), spacing: 12)], spacing: 12) {
                        ForEach(snapshot.aggregates) { aggregate in
                            AggregateCard(aggregate: aggregate, accent: model.definition.accent)
                        }
                    }
                }
                PrivacyBoundary(definition: model.definition)
            }
            .padding(24)
        }
        .navigationTitle("Inventory")
    }

    private func configuration(_ snapshot: SurfaceSnapshot) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                sectionHeader(
                    "Configuration boundary",
                    detail: "Presence is reported; environment values are never read into the UI."
                )
                SurfaceCard {
                    VStack(alignment: .leading, spacing: 12) {
                        Label("Workspace", systemImage: "folder")
                            .font(.headline)
                        Text(snapshot.repositoryRoot.path)
                            .font(.caption.monospaced())
                            .foregroundStyle(SurfaceTheme.secondary)
                            .textSelection(.enabled)
                        Divider()
                        HStack {
                            Text("Declared variables")
                            Spacer()
                            Text(snapshot.declaredEnvironmentCount.formatted())
                                .monospacedDigit()
                        }
                        HStack {
                            Text("Present variables")
                            Spacer()
                            Text(snapshot.configuredEnvironmentCount.formatted())
                                .monospacedDigit()
                        }
                    }
                }

                if !model.definition.environmentNames.isEmpty {
                    SurfaceCard {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Allowed configuration names")
                                .font(.headline)
                            ForEach(model.definition.environmentNames, id: \.self) { name in
                                Label(name, systemImage: "key.horizontal")
                                    .font(.caption.monospaced())
                                    .foregroundStyle(SurfaceTheme.secondary)
                            }
                        }
                    }
                }
                PrivacyBoundary(definition: model.definition)
            }
            .padding(24)
        }
        .navigationTitle("Configuration")
    }

    private func sectionHeader(_ title: String, detail: String) -> some View {
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

/// The wait, in the shape of the pane the read is about to produce: the
/// surface's own name and subtitle, the metric cards the overview leads with,
/// then the card grid every destination ends in. `ContentUnavailableView` is
/// the neighbour of this view and they say different things — that one says
/// nothing has been read and offers the remedy, this one says the read is
/// running and holds the cards' places so nothing jumps when they land.
private struct SurfaceReadingView: View {
    let name: String
    let destination: ConsoleDestination

    var body: some View {
        ScrollView {
            WisentSkeletonGroup(label: "Reading the \(name) surface", spacing: 24) {
                VStack(alignment: .leading, spacing: 8) {
                    WisentSkeleton(.heading, width: 280, height: 30)
                    WisentSkeleton(.line, width: 340)
                }
                // Only the overview opens with the three metric cards; the
                // other destinations go straight from their header to a grid.
                if destination == .overview {
                    HStack(spacing: 12) {
                        ForEach(0 ..< 3, id: \.self) { _ in
                            WisentSkeleton(.block, height: 96)
                        }
                    }
                    WisentSkeleton(.heading, width: 180)
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 240), spacing: 12)], spacing: 12) {
                    ForEach(0 ..< 4, id: \.self) { _ in
                        WisentSkeleton(.block, height: 88)
                    }
                }
            }
            .padding(24)
        }
        .navigationTitle(destination.title)
    }
}

private struct SurfaceCard<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        content
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(SurfaceTheme.surface, in: RoundedRectangle(cornerRadius: 12))
            .overlay {
                RoundedRectangle(cornerRadius: 12)
                    .stroke(SurfaceTheme.border, lineWidth: 1)
            }
    }
}

private struct MetricCard: View {
    let title: String
    let value: String
    let detail: String
    let symbol: String
    let accent: SurfaceAccent

    var body: some View {
        SurfaceCard {
            HStack(spacing: 12) {
                Image(systemName: symbol)
                    .font(.title2)
                    .foregroundStyle(SurfaceTheme.accent(accent))
                VStack(alignment: .leading, spacing: 4) {
                    Text(value)
                        .font(.title2.weight(.semibold).monospacedDigit())
                    Text(title)
                        .font(.subheadline.weight(.semibold))
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(SurfaceTheme.secondary)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}

private struct ContractCard: View {
    let check: ContractCheck
    let accent: SurfaceAccent

    var body: some View {
        SurfaceCard {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Image(systemName: check.isAvailable ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                        .foregroundStyle(check.isAvailable ? SurfaceTheme.available : SurfaceTheme.unavailable)
                    Spacer()
                    Text(check.isAvailable ? "Available" : "Unavailable")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(check.isAvailable ? SurfaceTheme.available : SurfaceTheme.unavailable)
                }
                Text(check.title)
                    .font(.headline)
                Text(check.detail)
                    .font(.caption)
                    .foregroundStyle(SurfaceTheme.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                Text(check.relativePath)
                    .font(.caption2.monospaced())
                    .foregroundStyle(SurfaceTheme.muted)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

private struct AggregateCard: View {
    let aggregate: SafeAggregate
    let accent: SurfaceAccent

    var body: some View {
        SurfaceCard {
            VStack(alignment: .leading, spacing: 8) {
                Image(systemName: "list.number")
                    .font(.title2)
                    .foregroundStyle(SurfaceTheme.accent(accent))
                Text(aggregate.count.map { aggregate.isTruncated ? "\($0)+" : $0.formatted() } ?? "Unavailable")
                    .font(.title.weight(.semibold).monospacedDigit())
                Text(aggregate.title)
                    .font(.headline)
                Text(aggregate.detail)
                    .font(.caption)
                    .foregroundStyle(SurfaceTheme.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

private struct PrivacyBoundary: View {
    let definition: SurfaceDefinition

    var body: some View {
        Label {
            VStack(alignment: .leading, spacing: 4) {
                Text("Protected local boundary")
                    .font(.subheadline.weight(.semibold))
                Text(definition.privacyBoundary)
                    .font(.caption)
                    .foregroundStyle(SurfaceTheme.secondary)
            }
        } icon: {
            Image(systemName: "hand.raised.fill")
                .foregroundStyle(SurfaceTheme.accent(definition.accent))
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SurfaceTheme.accent(definition.accent).opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
        .accessibilityElement(children: .combine)
    }
}

