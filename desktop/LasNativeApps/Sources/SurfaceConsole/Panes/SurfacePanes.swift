import AppKit
import SwiftUI
import WisentDesignSystem

// Three of the console's panes: the contract list, the safe inventory and
// the configuration boundary.
//
// Split out of `SurfaceRootView.swift`, which had grown past the
// three-hundred-line limit; the window, the sidebar and the overview stay
// there.

extension SurfaceRootView {
    func contracts(_ snapshot: SurfaceSnapshot) -> some View {
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

    func inventory(_ snapshot: SurfaceSnapshot) -> some View {
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

    func configuration(_ snapshot: SurfaceSnapshot) -> some View {
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
}
