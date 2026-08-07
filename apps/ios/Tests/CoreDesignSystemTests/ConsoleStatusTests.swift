import CoreDesignSystem
import Testing

/// The status strip's vocabulary, asserted as values.
///
/// The strip cannot be rendered in this package's CI, so what is held here is
/// everything about it that is not pixels: which states exist, which one is
/// worth interrupting someone for, and that the five are told apart by shape
/// as well as by colour. The strip is 24 points tall and is read outdoors.
@Suite("Console status")
struct ConsoleStatusTests {
    /// Only `attention` opens anything. A strip whose ordinary states are
    /// tappable teaches people to tap it, and then the one state that needs a
    /// person is indistinguishable from the four that do not.
    @Test("makes exactly the state that needs a person actionable")
    func onlyAttentionIsActionable() {
        for level in ConsoleStatus.Level.allCases {
            let status = ConsoleStatus(label: "x", level: level)
            #expect(status.isActionable == (level == .attention))
        }
    }

    /// WCAG 1.4.1 again, and it bites harder here than anywhere: this strip is
    /// the smallest text in the application, on the darkest surface, often in
    /// sunlight.
    @Test("gives every level its own silhouette")
    func symbolsAreDistinct() {
        let symbols = ConsoleStatus.Level.allCases.map(\.symbol)
        let named = symbols.filter { !$0.isEmpty }.count
        #expect(Set(symbols).count == ConsoleStatus.Level.allCases.count)
        #expect(named == ConsoleStatus.Level.allCases.count)
    }

    /// Work saved on the device is this application working as designed — it
    /// is offline-authoritative — so `pending` and `offline` are neutral, not
    /// warnings. Colouring the ordinary case amber is how a person learns to
    /// ignore the strip.
    @Test("reserves an alarming tone for the state that is actually wrong")
    func ordinaryStatesAreNotWarnings() {
        #expect(ConsoleStatus.Level.settled.tone == .positive)
        #expect(ConsoleStatus.Level.working.tone == .neutral)
        #expect(ConsoleStatus.Level.pending.tone == .neutral)
        #expect(ConsoleStatus.Level.offline.tone == .neutral)
        #expect(ConsoleStatus.Level.attention.tone == .negative)
    }

    @Test("carries a count only when there is something to count")
    func countIsOptional() {
        #expect(ConsoleStatus(label: "synced", level: .settled).count == nil)
        #expect(ConsoleStatus(label: "local", level: .pending, count: 3).count == 3)
    }
}
