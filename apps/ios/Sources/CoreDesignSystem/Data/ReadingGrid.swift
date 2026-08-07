import SwiftUI

/// One measurement in a ``ReadingGrid``, already formatted by its caller.
public struct ReadingCell: Identifiable, Equatable, Sendable {
    public let id: String
    public let symbol: String
    public let label: String
    public let value: String
    /// The provider did not report this field. Styled apart from a real
    /// number, because "not reported" and "zero" are different facts — and for
    /// precipitation they are opposite ones.
    public let isMissing: Bool

    public init(id: String, symbol: String, label: String, value: String, isMissing: Bool) {
        self.id = id
        self.symbol = symbol
        self.label = label
        self.value = value
        self.isMissing = isMissing
    }
}

/// A fixed grid of measurements, every cell always drawn.
///
/// Absent measurements are rendered as an explicit "not reported" rather than
/// omitted: a grid that silently drops the fields a provider did not send makes
/// a missing reading indistinguishable from a zero one.
///
/// Two columns rather than four. Russian measurement labels run roughly forty
/// percent longer than English ones, and a four-across row that fits "Wind"
/// does not fit "Влажность" at an accessibility text size.
public struct ReadingGrid: View {
    private let cells: [ReadingCell]

    private let columns = [
        GridItem(.flexible(), spacing: Metrics.space2),
        GridItem(.flexible(), spacing: Metrics.space2),
    ]

    public init(cells: [ReadingCell]) {
        self.cells = cells
    }

    public var body: some View {
        LazyVGrid(columns: columns, spacing: Metrics.space2) {
            ForEach(cells) { cell in
                HStack(spacing: Metrics.space2) {
                    Image(systemName: cell.symbol)
                        .imageScale(.medium)
                        .symbolRenderingMode(.hierarchical)
                        .foregroundStyle(cell.isMissing ? Palette.textMuted : Palette.text)

                    VStack(alignment: .leading, spacing: 0) {
                        Text(cell.label)
                            .font(FieldConsoleType.label.font)
                            .foregroundStyle(Palette.textMuted)
                        Text(cell.value)
                            // The numeral is mono so a column of readings lines
                            // up on its digits; an absent one is prose and is
                            // set as prose, which is the visible difference.
                            .font(
                                cell.isMissing
                                    ? FieldConsoleType.secondary.font
                                    : FieldConsoleType.monoStrong.font
                            )
                            .foregroundStyle(cell.isMissing ? Palette.textMuted : Palette.text)
                    }
                    Spacer(minLength: 0)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityElement(children: .combine)
            }
        }
    }
}
