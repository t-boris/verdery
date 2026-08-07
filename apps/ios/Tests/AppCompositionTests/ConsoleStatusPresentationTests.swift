import CoreDesignSystem
import CoreLocalization
import CoreSynchronization
import Foundation
import Testing

@testable import AppComposition

/// The engine-state → status-strip mapping, in both catalogues.
///
/// This is the whole of what can be verified about the sync surface without a
/// simulator, so it is where the decisions live: which state is worth
/// interrupting someone for, when a count is honest, and that a person is told
/// something in their own language in every case.
@Suite("Console status presentation")
struct ConsoleStatusPresentationTests {
    private static let locales = ["en", "ru"]

    private func strings(_ locale: String) -> LocalizedStrings {
        LocalizedStrings(locale: Locale(identifier: locale))
    }

    /// Every engine state produces a real, translated word — never a key
    /// leaking through, and never an empty strip.
    @Test("says something in every state, in both languages")
    func everyStateIsSpoken() {
        let states: [SyncEngineStatus] = [
            .unknown, .synchronizing, .savedLocally, .synchronized,
            .waitingForConnectivity, .requiresAttention,
        ]
        for locale in Self.locales {
            for state in states {
                let status = ConsoleStatusPresentation.status(
                    for: state, pendingCount: 2, strings: strings(locale)
                )
                #expect(!status.label.isEmpty)
                // `LocalizedStrings` returns the key itself when the catalogue
                // has no entry, which is what makes a missing translation
                // visible here rather than blank on screen.
                #expect(!status.label.contains("syncStatus."))
            }
        }
    }

    /// Only a genuine stall interrupts. Every other state is a report.
    @Test("escalates to attention only when retrying cannot clear it")
    func onlyRealStallsEscalate() {
        let attention = ConsoleStatusPresentation.status(
            for: .requiresAttention, pendingCount: 1, strings: strings("en")
        )
        #expect(attention.level == .attention)
        #expect(attention.isActionable)

        for state: SyncEngineStatus in [
            .unknown, .synchronizing, .savedLocally, .synchronized, .waitingForConnectivity,
        ] {
            let status = ConsoleStatusPresentation.status(
                for: state, pendingCount: 1, strings: strings("en")
            )
            #expect(!status.isActionable, "\(state) should not be actionable")
        }
    }

    /// A cycle in flight is about to change the number, and a figure that ticks
    /// down and back up reads as a fault rather than as progress.
    @Test("withholds the count while a cycle is running")
    func noCountWhileSynchronizing() {
        let status = ConsoleStatusPresentation.status(
            for: .synchronizing, pendingCount: 7, strings: strings("en")
        )
        #expect(status.count == nil)
        #expect(status.level == .working)
    }

    /// Offline is not an error in an offline-authoritative application. It is
    /// the ordinary case, and it reports how much is waiting.
    @Test("treats waiting for connectivity as a report, with its backlog")
    func offlineCarriesItsBacklog() {
        let status = ConsoleStatusPresentation.status(
            for: .waitingForConnectivity, pendingCount: 4, strings: strings("en")
        )
        #expect(status.level == .offline)
        #expect(status.count == 4)
        #expect(status.level.tone == .neutral)
    }

    /// `unknown` means no cycle has run on this engine yet — which happens on
    /// every launch. A queue is a fact even when the engine has no result to
    /// report about it, so saying "on device, 3" beats saying nothing.
    @Test("reports queued work at launch, before any cycle has run")
    func unknownStillReportsAQueue() {
        let queued = ConsoleStatusPresentation.status(
            for: .unknown, pendingCount: 3, strings: strings("en")
        )
        #expect(queued.level == .pending)
        #expect(queued.count == 3)

        let empty = ConsoleStatusPresentation.status(
            for: .unknown, pendingCount: 0, strings: strings("en")
        )
        #expect(empty.level == .settled)
        #expect(empty.count == nil)
    }
}
