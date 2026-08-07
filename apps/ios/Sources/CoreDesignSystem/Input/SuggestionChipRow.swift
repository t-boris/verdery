import SwiftUI

/// Ready-made answers that fill a ``ComposerField`` without committing it.
///
/// An empty field is a small piece of homework. Offering two or three plausible
/// names turns naming a garden into a tap, and — because a suggestion only
/// fills the field — leaves the person free to edit or ignore it. Nothing is
/// created until they commit, so a suggestion can never become a record
/// somebody did not mean to make.
///
/// Source: apps/web/features/gardens/create-garden-form.tsx.
public struct SuggestionChipRow: View {
    private let hint: String
    private let suggestions: [String]
    private let choose: (String) -> Void

    @ScaledSize(Metrics.minimumTouchTarget) private var minimumTarget

    public init(hint: String, suggestions: [String], choose: @escaping (String) -> Void) {
        self.hint = hint
        self.suggestions = suggestions
        self.choose = choose
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            HStack(spacing: Metrics.space1) {
                Image(systemName: "sparkles")
                    .imageScale(.small)
                    .accessibilityHidden(true)
                Text(hint)
                    .textCase(.uppercase)
            }
            .font(FieldConsoleType.label.font)
            .foregroundStyle(Palette.textMuted)

            // Wrapping rather than a horizontal scroll: three short words fit
            // on one line in English and often take two in Russian, and a
            // suggestion a reader has to scroll to find is not a shortcut.
            FlowRow(spacing: Metrics.space2) {
                ForEach(suggestions, id: \.self) { suggestion in
                    Button { choose(suggestion) } label: {
                        Text(suggestion)
                            .font(FieldConsoleType.secondary.font)
                            .foregroundStyle(Palette.text)
                            .padding(.horizontal, Metrics.space3)
                            .padding(.vertical, Metrics.space2)
                            .frame(minHeight: minimumTarget)
                            .background(
                                Capsule(style: .continuous)
                                    .fill(Palette.surfaceSunken)
                            )
                            .overlay(
                                Capsule(style: .continuous)
                                    .strokeBorder(Palette.border, lineWidth: Metrics.hairline)
                            )
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }
}

/// A row that wraps onto as many lines as it needs.
///
/// SwiftUI has no wrapping stack, and the usual stand-in — a `LazyVGrid` with
/// adaptive columns — sizes every cell to the widest one, which turns a row of
/// chips into a grid of mostly-empty boxes. This lays each subview out at its
/// own width and starts a new line when the next one will not fit, which is
/// what a chip row is.
public struct FlowRow: Layout {
    private let spacing: CGFloat

    public init(spacing: CGFloat) {
        self.spacing = spacing
    }

    public func sizeThatFits(
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) -> CGSize {
        let maxWidth = proposal.width ?? .infinity
        var rowWidth: CGFloat = 0
        var rowHeight: CGFloat = 0
        var totalHeight: CGFloat = 0
        var widest: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if rowWidth > 0, rowWidth + spacing + size.width > maxWidth {
                widest = max(widest, rowWidth)
                totalHeight += rowHeight + spacing
                rowWidth = size.width
                rowHeight = size.height
            } else {
                rowWidth += rowWidth > 0 ? spacing + size.width : size.width
                rowHeight = max(rowHeight, size.height)
            }
        }

        widest = max(widest, rowWidth)
        return CGSize(width: min(widest, maxWidth), height: totalHeight + rowHeight)
    }

    public func placeSubviews(
        in bounds: CGRect,
        proposal: ProposedViewSize,
        subviews: Subviews,
        cache: inout ()
    ) {
        var x = bounds.minX
        var y = bounds.minY
        var rowHeight: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                x = bounds.minX
                y += rowHeight + spacing
                rowHeight = 0
            }
            subview.place(at: CGPoint(x: x, y: y), anchor: .topLeading, proposal: .unspecified)
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
        }
    }
}
