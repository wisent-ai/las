import SwiftUI

/// The fleet's skeleton views, in the one shape every Wisent surface uses.
///
/// This package has no external dependencies — seven apps are built from it and
/// each one ships alone — so it cannot import `WisentDesignSystem`. It carries
/// the shared views here instead, with the same names, the same signatures and
/// the same behaviour, and only the colour tokens taken from `SurfaceTheme`.
/// There is one copy of this file in the package, so no call site has to choose
/// between two skeletons.

/// One placeholder in the shape of the content that has not arrived yet.
///
/// A skeleton is decoration: it stands in for a line, a heading, a thumbnail or
/// an avatar so the layout the operator is about to read is already there. It
/// carries no accessible name of its own — the group around it announces the
/// wait once, which is why every composite in this file labels itself and hides
/// its own bars.
struct WisentSkeleton: View {
    enum Shape: Sendable {
        case line
        case heading
        case block
        case circle
        case pill

        var size: CGSize? {
            switch self {
            case .line: CGSize(width: -1, height: 10)
            case .heading: CGSize(width: -1, height: 16)
            case .block: nil
            case .circle: CGSize(width: 36, height: 36)
            case .pill: CGSize(width: 80, height: 22)
            }
        }

        var radius: CGFloat {
            switch self {
            case .line: 4
            case .heading: 6
            case .block: 12
            case .circle: 999
            case .pill: 999
            }
        }
    }

    private let shape: Shape
    private let width: CGFloat?
    private let height: CGFloat?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var phase: CGFloat = -0.4

    init(
        _ shape: Shape = .line,
        width: CGFloat? = nil,
        height: CGFloat? = nil
    ) {
        self.shape = shape
        self.width = width
        self.height = height
    }

    var body: some View {
        RoundedRectangle(cornerRadius: shape.radius, style: .continuous)
            .fill(fill)
            .frame(width: resolvedWidth, height: resolvedHeight)
            .frame(maxWidth: resolvedWidth == nil ? .infinity : nil)
            .accessibilityHidden(true)
            .onAppear(perform: startSweep)
    }

    private var fill: LinearGradient {
        guard !reduceMotion else {
            return LinearGradient(
                colors: [SurfaceTheme.skeletonBar, SurfaceTheme.skeletonBar],
                startPoint: .leading,
                endPoint: .trailing
            )
        }
        return LinearGradient(
            stops: [
                .init(color: SurfaceTheme.skeletonBar, location: 0),
                .init(color: SurfaceTheme.skeletonSweep, location: 0.5),
                .init(color: SurfaceTheme.skeletonBar, location: 1),
            ],
            startPoint: UnitPoint(x: phase - 0.4, y: 0.5),
            endPoint: UnitPoint(x: phase + 0.4, y: 0.5)
        )
    }

    private var resolvedWidth: CGFloat? {
        if let width { return width }
        guard let size = shape.size, size.width > 0 else { return nil }
        return size.width
    }

    private var resolvedHeight: CGFloat? {
        height ?? shape.size?.height
    }

    private func startSweep() {
        guard !reduceMotion else { return }
        withAnimation(.easeInOut(duration: 1.4).repeatForever(autoreverses: false)) {
            phase = 1.4
        }
    }
}

/// The one place a loading region announces itself.
///
/// `label` names what is being read, because "Loading" alone tells an operator
/// nothing about which surface is waiting.
struct WisentSkeletonGroup<Content: View>: View {
    private let label: String
    private let spacing: CGFloat
    private let content: () -> Content

    init(
        label: String,
        spacing: CGFloat = 8,
        @ViewBuilder content: @escaping () -> Content
    ) {
        self.label = label
        self.spacing = spacing
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: spacing) {
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityIdentifier("wisent.skeleton")
    }
}

/// Prose that has not arrived: `lines` bars, the last one short so the block
/// reads as a paragraph rather than a filled rectangle.
struct WisentSkeletonText: View {
    private let lines: Int
    private let label: String
    private let lastLineFraction: CGFloat

    init(
        lines: Int = 3,
        label: String = "Loading",
        lastLineFraction: CGFloat = 0.62
    ) {
        precondition(lines >= 1, "Skeleton text needs at least one line")
        self.lines = lines
        self.label = label
        self.lastLineFraction = lastLineFraction
    }

    var body: some View {
        WisentSkeletonGroup(label: label) {
            ForEach(0 ..< lines, id: \.self) { index in
                if index == lines - 1, lines > 1 {
                    WisentSkeleton(.line)
                        .containerRelativeFrame(.horizontal, alignment: .leading) { width, _ in
                            width * lastLineFraction
                        }
                } else {
                    WisentSkeleton(.line)
                }
            }
        }
    }
}

/// Rows that will become records: an optional leading circle where the avatar
/// or status glyph lands, then the row's own lines.
struct WisentSkeletonList: View {
    private let rows: Int
    private let lines: Int
    private let media: Bool
    private let label: String

    init(
        rows: Int = 3,
        lines: Int = 2,
        media: Bool = true,
        label: String = "Loading"
    ) {
        precondition(rows >= 1, "Skeleton list needs at least one row")
        precondition(lines >= 1, "Skeleton list needs at least one line per row")
        self.rows = rows
        self.lines = lines
        self.media = media
        self.label = label
    }

    var body: some View {
        WisentSkeletonGroup(label: label, spacing: 16) {
            ForEach(0 ..< rows, id: \.self) { _ in
                HStack(spacing: 12) {
                    if media {
                        WisentSkeleton(.circle)
                    }
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(0 ..< lines, id: \.self) { line in
                            if line == 0 {
                                WisentSkeleton(.line)
                            } else {
                                WisentSkeleton(.line)
                                    .containerRelativeFrame(.horizontal, alignment: .leading) { width, _ in
                                        width * 0.58
                                    }
                            }
                        }
                    }
                }
            }
        }
    }
}

/// A table keeps its own column count while it loads, so the header does not
/// jump sideways when the rows land.
struct WisentSkeletonTable: View {
    private let rows: Int
    private let columns: Int
    private let header: Bool
    private let label: String

    init(
        rows: Int = 5,
        columns: Int = 4,
        header: Bool = true,
        label: String = "Loading"
    ) {
        precondition(rows >= 1, "Skeleton table needs at least one row")
        precondition(columns >= 1, "Skeleton table needs at least one column")
        self.rows = rows
        self.columns = columns
        self.header = header
        self.label = label
    }

    var body: some View {
        WisentSkeletonGroup(label: label, spacing: 12) {
            if header {
                row(isHeader: true)
                Divider().overlay(SurfaceTheme.border)
            }
            ForEach(0 ..< rows, id: \.self) { _ in
                row(isHeader: false)
            }
        }
    }

    private func row(isHeader: Bool) -> some View {
        HStack(spacing: 16) {
            ForEach(0 ..< columns, id: \.self) { _ in
                WisentSkeleton(isHeader ? .heading : .line)
            }
        }
    }
}
