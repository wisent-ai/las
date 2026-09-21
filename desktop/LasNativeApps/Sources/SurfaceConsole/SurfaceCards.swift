import AppKit
import SwiftUI
import WisentDesignSystem

// The pieces every console pane is built from: the waiting state, the card
// frame, and the four cards that carry a metric, a contract, an aggregate
// and the privacy boundary.
//
// Split out of `SurfaceRootView.swift`, which had grown past the
// three-hundred-line limit; the panes themselves stay there.

/// The wait, in the shape of the pane the read is about to produce: the
/// surface's own name and subtitle, the metric cards the overview leads with,
/// then the card grid every destination ends in. `ContentUnavailableView` is
/// the neighbour of this view and they say different things — that one says
/// nothing has been read and offers the remedy, this one says the read is
/// running and holds the cards' places so nothing jumps when they land.
struct SurfaceReadingView: View {
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

struct SurfaceCard<Content: View>: View {
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

struct MetricCard: View {
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

struct ContractCard: View {
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

struct AggregateCard: View {
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

struct PrivacyBoundary: View {
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

