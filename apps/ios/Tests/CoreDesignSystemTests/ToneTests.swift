import CoreDesignSystem
import Testing

/// The tone vocabulary itself, as distinct from the colours it resolves to.
///
/// Field Console rests on one separation: orange is what you can act on, and a
/// tone is what a record *is*. The previous enum broke that by carrying an
/// `accent` case, and because that case was also the default of `Chip`,
/// `IconMedallion`, `MetricTile`, `CompactActionButton` and the quiet button
/// style, seventeen surfaces wore the interaction signal purely by not
/// choosing. This suite is what stops the case coming back.
@Suite("Tone vocabulary")
struct ToneTests {
    /// Four cases, and specifically not an interaction one. Adding a fifth is
    /// a design decision; this test is where it has to be argued.
    @Test("carries exactly the four status meanings")
    func vocabularyIsClosed() {
        #expect(Tone.allCases == [.neutral, .positive, .warning, .negative])
    }

    /// WCAG 1.4.1: state may not be conveyed by hue alone. The symbol lives on
    /// the tone rather than at the call site so it cannot be forgotten, and
    /// these have to be four different silhouettes — four recoloured circles
    /// would satisfy the type and none of the requirement.
    @Test("gives every tone a distinct symbol, so state is never colour alone")
    func symbolsAreDistinct() {
        let symbols = Tone.allCases.map(\.symbol)
        let namedCount = symbols.filter { !$0.isEmpty }.count
        #expect(Set(symbols).count == Tone.allCases.count)
        #expect(namedCount == Tone.allCases.count)
    }
}
