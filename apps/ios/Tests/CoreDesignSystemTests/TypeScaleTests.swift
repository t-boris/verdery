import CoreDesignSystem
import SwiftUI
import Testing

/// The type scale, asserted as a table.
///
/// A size that drifts from the token it came from, or a style that quietly
/// loses its `relativeTo:` anchor, is invisible until someone renders the app
/// at an accessibility text size on a device — which this package's CI cannot
/// do. Writing the table down twice, once as the scale and once as the
/// expectation, is what makes the drift a failing test instead.
@Suite("Type scale")
struct TypeScaleTests {
    private struct Expectation: Sendable {
        let name: String
        let style: TypeStyle
        let face: FontFace
        let size: CGFloat
        let relativeTo: Font.TextStyle
    }

    private static let table: [Expectation] = [
        .init(
            name: "display", style: FieldConsoleType.display, face: .sansBold, size: 24,
            relativeTo: .title2
        ),
        .init(
            name: "title", style: FieldConsoleType.title, face: .sansSemiBold, size: 20,
            relativeTo: .title3
        ),
        .init(
            name: "heading", style: FieldConsoleType.heading, face: .sansSemiBold, size: 17,
            relativeTo: .callout
        ),
        .init(
            name: "body", style: FieldConsoleType.body, face: .sansRegular, size: 16,
            relativeTo: .body
        ),
        .init(
            name: "bodyStrong", style: FieldConsoleType.bodyStrong, face: .sansMedium, size: 16,
            relativeTo: .body
        ),
        .init(
            name: "secondary", style: FieldConsoleType.secondary, face: .sansRegular, size: 13,
            relativeTo: .footnote
        ),
        .init(
            name: "detail", style: FieldConsoleType.detail, face: .sansRegular, size: 11,
            relativeTo: .caption2
        ),
        .init(
            name: "mono", style: FieldConsoleType.mono, face: .monoRegular, size: 13,
            relativeTo: .footnote
        ),
        .init(
            name: "monoStrong", style: FieldConsoleType.monoStrong, face: .monoMedium, size: 13,
            relativeTo: .footnote
        ),
        .init(
            name: "metric", style: FieldConsoleType.metric, face: .monoSemiBold, size: 20,
            relativeTo: .title3
        ),
        .init(
            name: "metricLarge", style: FieldConsoleType.metricLarge, face: .monoSemiBold, size: 24,
            relativeTo: .title2
        ),
        .init(
            name: "label", style: FieldConsoleType.label, face: .monoMedium, size: 10,
            relativeTo: .caption2
        ),
    ]

    @Test("matches the declared face, size, and Dynamic Type anchor")
    func scaleMatchesItsTable() {
        for entry in Self.table {
            #expect(entry.style.face == entry.face, "\(entry.name) uses the wrong face")
            #expect(entry.style.size == entry.size, "\(entry.name) is the wrong size")
            #expect(
                entry.style.relativeTo == entry.relativeTo,
                "\(entry.name) scales against the wrong text style"
            )
        }
    }

    /// Prose is Plex Sans, machine output is Plex Mono. The split is the
    /// language's own rule, not a per-call-site preference, so it is worth
    /// holding: a measurement that drifts into the prose face stops being
    /// monospaced, and a row of numbers starts reflowing as it updates.
    @Test("keeps prose in the sans family and machine output in the mono family")
    func familiesMatchTheirRole() {
        let prose = ["display", "title", "heading", "body", "bodyStrong", "secondary", "detail"]
        for entry in Self.table {
            let isSans = entry.face.postScriptName.hasPrefix("IBMPlexSans")
            #expect(
                isSans == prose.contains(entry.name),
                "\(entry.name) is in the wrong family for its role"
            )
        }
    }

    /// The label token exists so its three declarations live in one place.
    /// If it ever stops being the smallest thing in the scale, something has
    /// been sized by eye rather than taken from the table.
    @Test("keeps the label the smallest step in the scale")
    func labelIsTheSmallestStep() {
        let smallest = Self.table.map(\.size).min()
        #expect(FieldConsoleType.label.size == smallest)
        #expect(FieldConsoleType.label.size == TypeScale.label)
    }
}
