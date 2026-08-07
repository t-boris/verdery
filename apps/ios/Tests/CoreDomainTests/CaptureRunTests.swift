import Foundation
import Testing

@testable import CoreDomain

/// A walk through the garden, counted.
@Suite("Capture run")
struct CaptureRunTests {
    private func shot(
        _ id: String,
        _ stage: CapturedShot.Stage,
        secondsIn: TimeInterval = 0
    ) -> CapturedShot {
        CapturedShot(
            plantId: id,
            capturedAt: Date(timeIntervalSince1970: secondsIn),
            stage: stage
        )
    }

    /// The property the whole loop rests on: a shot is safe the moment it is
    /// taken, before anything has touched a network.
    @Test("counts a new shot as saved, not as pending anything")
    func newShotIsSaved() {
        var run = CaptureRun()
        run.record(shot("plant-1", .saved))
        #expect(run.count == 1)
        #expect(run.shots.first?.stage == .saved)
    }

    /// Four separate numbers, not a percentage: "12 photos, 9 identified, 3
    /// need you" answers both questions a person has, and a single progress
    /// figure answers neither.
    @Test("summarises a finished walk")
    func summarisesTheWalk() {
        var run = CaptureRun()
        run.record(shot("a", .resolved))
        run.record(shot("b", .resolved))
        run.record(shot("c", .awaitingReview))
        run.record(shot("d", .uploading))
        run.record(shot("e", .saved))
        run.record(shot("f", .failed(reasonCode: "media.uploadFailed")))

        let summary = run.summary
        #expect(summary.captured == 6)
        #expect(summary.resolved == 2)
        #expect(summary.awaitingReview == 1)
        #expect(summary.stillUploading == 2)
        #expect(summary.failed == 1)
        #expect(!summary.isComplete)
    }

    @Test("reports a walk with nothing left for anybody as complete")
    func completeWhenNothingIsLeft() {
        var run = CaptureRun()
        run.record(shot("a", .resolved))
        run.record(shot("b", .resolved))
        #expect(run.summary.isComplete)
    }

    /// An identification in flight is still "in progress" from a person's
    /// point of view, even though the photograph has already landed.
    @Test("counts an identification in flight as still working")
    func identifyingCountsAsWorking() {
        var run = CaptureRun()
        run.record(shot("a", .identifying))
        #expect(run.summary.stillUploading == 1)
        #expect(run.summary.awaitingReview == 0)
    }

    /// Capture order, because a walk reviewed in the order it was seen is a
    /// walk somebody can still remember.
    @Test("offers the review stack oldest first")
    func reviewIsOldestFirst() {
        var run = CaptureRun()
        run.record(shot("late", .awaitingReview, secondsIn: 300))
        run.record(shot("early", .awaitingReview, secondsIn: 100))
        run.record(shot("done", .resolved, secondsIn: 200))

        #expect(run.awaitingReview.map(\.plantId) == ["early", "late"])
    }

    @Test("moves a shot on as its enrichment arrives")
    func advancesStage() {
        var run = CaptureRun()
        run.record(shot("a", .saved))
        run.update(plantId: "a", to: .identifying)
        run.update(plantId: "a", to: .awaitingReview)
        #expect(run.shots.first?.stage == .awaitingReview)
    }

    /// A late callback for a shot that is no longer in this run must not
    /// resurrect it or crash the walk.
    @Test("ignores an update for something it does not hold")
    func ignoresUnknownShots() {
        var run = CaptureRun()
        run.record(shot("a", .saved))
        run.update(plantId: "gone", to: .resolved)
        #expect(run.count == 1)
        #expect(run.shots.first?.stage == .saved)
    }
}
