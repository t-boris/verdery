import Foundation
import Testing

@testable import CoreDomain

/// Reducing a sitting's worth of swipes to the commands it means.
///
/// The properties asserted here are the ones that decide whether ADR-0015
/// holds: exactly one confirm per accepted suggestion, nothing at all for a
/// decline, and nothing for a card somebody merely looked at.
@Suite("Identification review")
struct IdentificationReviewTests {
    private func item(
        _ id: String,
        name: String? = "Rosa rugosa",
        confidence: Double = 0.82,
        revision: Int = 3,
        secondsAgo: TimeInterval = 0
    ) -> IdentificationReviewItem {
        IdentificationReviewItem(
            plantId: id,
            identificationId: "ident-\(id)",
            plantRevision: revision,
            suggestedName: name,
            confidence: confidence,
            photoMediaId: nil,
            capturedAt: Date(timeIntervalSince1970: 1_780_000_000 - secondsAgo)
        )
    }

    @Test("sends one confirm per accepted suggestion and nothing for a decline")
    func confirmsOnlyWhatWasAccepted() {
        let items = [item("a"), item("b"), item("c")]
        let commands = IdentificationReviews.commands(
            for: items,
            answers: ["a": .confirm, "b": .skip, "c": .confirm]
        )
        #expect(commands.map(\.plantId) == ["a", "c"])
        // The revision the command quotes is the plant's own, carried rather
        // than re-fetched — fifteen answers must cost fifteen commands.
        #expect(commands.allSatisfy { $0.expectedRevision == 3 })
        #expect(commands.map(\.identificationId) == ["ident-a", "ident-c"])
    }

    /// Declining is the absence of a server fact, not a fact of its own: the
    /// plant already exists with its photograph as its identity.
    @Test("a decline is not a command")
    func declineSendsNothing() {
        #expect(
            IdentificationReviews.commands(
                for: [item("a")],
                answers: ["a": .skip]
            ).isEmpty
        )
    }

    /// Going to look at something is not deciding about it.
    @Test("opening a card neither answers it nor removes it")
    func openingIsNotAnswering() {
        let items = [item("a"), item("b")]
        let answers: [String: IdentificationReviewAnswer] = ["a": .open]

        #expect(IdentificationReviews.commands(for: items, answers: answers).isEmpty)
        #expect(IdentificationReviews.remaining(in: items, answers: answers).count == 2)
    }

    /// A suggestion with no name is a card that can only be skipped. Confirming
    /// one would send a command that records nothing.
    @Test("refuses to confirm a suggestion with no name")
    func unnamedSuggestionCannotBeConfirmed() {
        let unnamed = item("a", name: nil)
        #expect(!unnamed.isConfirmable)
        #expect(
            IdentificationReviews.commands(
                for: [unnamed],
                answers: ["a": .confirm]
            ).isEmpty
        )

        #expect(!item("b", name: "").isConfirmable)
    }

    @Test("counts what is left, and reaches zero only when everything is answered")
    func remainingCount() {
        let items = [item("a"), item("b"), item("c")]
        #expect(IdentificationReviews.remaining(in: items, answers: [:]).count == 3)
        #expect(
            IdentificationReviews.remaining(
                in: items,
                answers: ["a": .confirm, "b": .skip]
            ).map(\.plantId) == ["c"]
        )
        #expect(
            IdentificationReviews.remaining(
                in: items,
                answers: ["a": .confirm, "b": .skip, "c": .skip]
            ).isEmpty
        )
    }

    /// An unanswered stack produces nothing at all — the case that matters
    /// when somebody opens the screen and puts the phone down.
    @Test("an untouched stack sends nothing")
    func untouchedStack() {
        #expect(IdentificationReviews.commands(for: [item("a"), item("b")], answers: [:]).isEmpty)
    }
}

/// What a walk produced.
@Suite("Capture run summary")
struct CaptureRunSummaryTests {
    private func shot(_ id: String, _ stage: CapturedShot.Stage) -> CapturedShot {
        CapturedShot(
            plantId: id,
            capturedAt: Date(timeIntervalSince1970: 1_780_000_000),
            stage: stage
        )
    }

    /// Four separate numbers, because "is my work safe" and "what is left for
    /// me" are two questions and a percentage answers neither.
    @Test("counts each stage into its own figure")
    func countsByStage() {
        let run = CaptureRun(shots: [
            shot("a", .saved),
            shot("b", .uploading),
            shot("c", .identifying),
            shot("d", .awaitingReview),
            shot("e", .resolved),
            shot("f", .failed(reasonCode: "provider_failed")),
        ])

        let summary = run.summary
        #expect(summary.captured == 6)
        #expect(summary.resolved == 1)
        #expect(summary.awaitingReview == 1)
        // Saved, uploading and identifying are all "the network still has work
        // to do", which is the one thing a person cannot help with.
        #expect(summary.stillUploading == 3)
        #expect(summary.failed == 1)
        #expect(!summary.isComplete)
    }

    @Test("is complete only when nothing waits on a person or the network")
    func completeness() {
        #expect(CaptureRun(shots: [shot("a", .resolved)]).summary.isComplete)
        #expect(!CaptureRun(shots: [shot("a", .awaitingReview)]).summary.isComplete)
        #expect(!CaptureRun(shots: [shot("a", .uploading)]).summary.isComplete)
        #expect(!CaptureRun(shots: [shot("a", .failed(reasonCode: "x"))]).summary.isComplete)
        // An empty run is trivially complete, which is right: nothing was
        // photographed, so nothing is outstanding.
        #expect(CaptureRun().summary.isComplete)
    }

    /// Capture order, because a walk reviewed in the order it was walked is a
    /// walk somebody can still remember.
    @Test("offers what awaits review oldest first")
    func awaitingReviewOrder() {
        var run = CaptureRun()
        run.record(
            CapturedShot(
                plantId: "new",
                capturedAt: Date(timeIntervalSince1970: 1_780_000_100),
                stage: .awaitingReview
            )
        )
        run.record(
            CapturedShot(
                plantId: "old",
                capturedAt: Date(timeIntervalSince1970: 1_780_000_000),
                stage: .awaitingReview
            )
        )
        #expect(run.awaitingReview.map(\.plantId) == ["old", "new"])
    }
}
