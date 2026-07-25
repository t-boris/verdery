import CoreDomain
import CoreLocalization
import CoreNetworking
import Foundation
import Testing

@testable import FeatureRecommendations

/// P7-IOS-01's acceptance evidence: the complete native care loop, walked
/// end to end at the view-model layer against the stateful fake gateway —
/// the established "pure types under thin views" convention (no simulator
/// exists in the headless test environment; what the thin SwiftUI layer
/// alone adds is the one thing this suite cannot cover).
///
/// The loop: fetch Today → present the prioritized set → convert the top
/// item to a task (origin-linked task created, item leaves the set on the
/// refresh the action itself triggers) → each feedback outcome (complete,
/// postpone with and without a horizon, dismiss, mark-irrelevant on a
/// still-visible item) → the honest empty state once everything is acted
/// on → the feedback trail read back from the fake's rows alone.
@MainActor
@Suite("Today care loop end to end")
struct TodayCareLoopEndToEndTests {
    @Test("The complete care loop: fetch, present, convert, feedback outcomes, refreshed list, empty state")
    func completeCareLoop() async throws {
        let gateway = FakeRecommendationGateway(items: [
            TodayFixtures.todayItem(id: "rec-water", actionTitle: "Deep-soak the tomato bed", priorityScore: 72),
            TodayFixtures.todayItem(id: "rec-stake", actionTitle: "Stake the beans", priorityScore: 55, urgency: .normal),
            TodayFixtures.todayItem(id: "rec-mulch", actionTitle: "Mulch the strawberry row", priorityScore: 40),
            TodayFixtures.todayItem(id: "rec-prune", actionTitle: "Prune the raspberry canes", priorityScore: 30),
        ])
        let model = TodayFixtures.makeModel(gateway: gateway)

        // 1. Fetch: the prioritized set arrives in server order.
        await model.load()
        guard case let .loaded(items) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        #expect(items.map(\.id) == ["rec-water", "rec-stake", "rec-mulch", "rec-prune"])
        #expect(gateway.todayRequestCount == 1)

        // 2. Convert the top item: the task carries the candidate's action
        //    title, explanation, target, urgency, and window verbatim —
        //    and the item leaves Today on the action's own refresh.
        await model.convert(itemId: "rec-water")
        #expect(model.actionErrorMessage == nil)

        let task = try #require(model.convertedTask)
        #expect(task.title == "Deep-soak the tomato bed")
        #expect(task.notes == "Six dry days in a heat spell.")
        #expect(task.source == .suggested)
        #expect(task.status == .planned)
        #expect(task.urgency == .high)
        #expect(task.targetKind == .plant)
        #expect(task.targetPlantId == "plant-1")
        #expect(task.dueDate == nil)
        #expect(gateway.createdTasks.count == 1)
        #expect(model.convertedItemId == "rec-water")
        #expect(model.convertedMessage?.contains("Deep-soak the tomato bed") == true)

        guard case let .loaded(afterConvert) = model.state else {
            Issue.record("Expected loaded state after conversion")
            return
        }
        #expect(afterConvert.map(\.id) == ["rec-stake", "rec-mulch", "rec-prune"])

        // 3. Mark-irrelevant on a still-visible item: feedback recorded,
        //    NO transition — the item stays presented and nothing refreshes.
        let requestsBeforeIrrelevant = gateway.todayRequestCount
        await model.markIrrelevant(itemId: "rec-stake")
        #expect(model.actionErrorMessage == nil)
        #expect(model.irrelevantRecordedItemId == "rec-stake")
        #expect(gateway.todayRequestCount == requestsBeforeIrrelevant)
        guard case let .loaded(afterIrrelevant) = model.state else {
            Issue.record("Expected loaded state after mark-irrelevant")
            return
        }
        #expect(afterIrrelevant.map(\.id).contains("rec-stake"))

        // 4. Dismiss the same item — the "accompanies or follows a
        //    dismissal" pairing, here preceding it.
        await model.dismiss(itemId: "rec-stake")
        #expect(model.actionErrorMessage == nil)

        // 5. Postpone with the user's own horizon.
        let horizon = Date(timeIntervalSince1970: 1_786_000_000)
        model.postponingItemId = "rec-mulch"
        await model.submitPostpone(itemId: "rec-mulch", until: horizon)
        #expect(model.actionErrorMessage == nil)
        #expect(model.postponingItemId == nil)

        // 6. Complete the last item: the did-it-now completion, no task.
        await model.complete(itemId: "rec-prune")
        #expect(model.actionErrorMessage == nil)

        // 7. The set is exhausted: an honest empty state, not an error.
        #expect(model.state == .loaded([]))
        #expect(model.staleNoticeText == nil)

        // 8. The whole loop read back from the recorded rows alone: one
        //    conversion-completion, one irrelevant + dismissal pair, one
        //    postponement carrying the horizon, one plain completion —
        //    each command with its own idempotency key.
        #expect(
            gateway.feedback == [
                FakeRecommendationGateway.FeedbackEntry(
                    recommendationId: "rec-water", kind: "completed", postponedUntil: nil),
                FakeRecommendationGateway.FeedbackEntry(
                    recommendationId: "rec-stake", kind: "irrelevant", postponedUntil: nil),
                FakeRecommendationGateway.FeedbackEntry(
                    recommendationId: "rec-stake", kind: "dismissed", postponedUntil: nil),
                FakeRecommendationGateway.FeedbackEntry(
                    recommendationId: "rec-mulch", kind: "postponed", postponedUntil: horizon),
                FakeRecommendationGateway.FeedbackEntry(
                    recommendationId: "rec-prune", kind: "completed", postponedUntil: nil),
            ])
        #expect(gateway.idempotencyKeys.count == 5)
        #expect(Set(gateway.idempotencyKeys).count == 5)
        // The conversion-completion is distinguished by its task; the
        // did-it-now completion left none.
        #expect(gateway.createdTasks.map(\.title) == ["Deep-soak the tomato bed"])
    }

    @Test("Postponing without a horizon leaves re-surfacing to the rule — no date invented")
    func postponeWithoutHorizon() async throws {
        let gateway = FakeRecommendationGateway(items: [TodayFixtures.todayItem(id: "rec-1")])
        let model = TodayFixtures.makeModel(gateway: gateway)

        await model.load()
        await model.submitPostpone(itemId: "rec-1", until: nil)

        #expect(model.actionErrorMessage == nil)
        let entry = try #require(gateway.feedback.first)
        #expect(entry.kind == "postponed")
        #expect(entry.postponedUntil == nil)
        #expect(model.state == .loaded([]))
    }

    @Test("A revision-guard loss surfaces the conflict message and refreshes to the current state")
    func revisionConflictRefreshes() async {
        let gateway = FakeRecommendationGateway(items: [TodayFixtures.todayItem(id: "rec-1", revision: 2)])
        let model = TodayFixtures.makeModel(gateway: gateway)

        await model.load()
        gateway.nextFailure = FakeRecommendationGateway.serviceError(
            statusCode: 412, code: "shared.revision_mismatch")
        let requestsBefore = gateway.todayRequestCount

        await model.complete(itemId: "rec-1")

        #expect(model.actionErrorMessage?.contains("changed on the server") == true)
        #expect(gateway.todayRequestCount == requestsBefore + 1)
        // Nothing was acted on: the candidate is still in the set.
        guard case let .loaded(items) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        #expect(items.map(\.id) == ["rec-1"])
        #expect(gateway.feedback.isEmpty)
    }

    @Test("An action attempted offline fails honestly and changes nothing")
    func offlineActionFailsHonestly() async {
        let gateway = FakeRecommendationGateway(items: [TodayFixtures.todayItem(id: "rec-1")])
        let model = TodayFixtures.makeModel(gateway: gateway)

        await model.load()
        gateway.nextFailure = .transport(code: .notConnectedToInternet, correlationId: "corr-3")

        await model.convert(itemId: "rec-1")

        #expect(model.actionErrorMessage != nil)
        #expect(model.convertedTask == nil)
        #expect(gateway.createdTasks.isEmpty)
        guard case let .loaded(items) = model.state else {
            Issue.record("Expected loaded state")
            return
        }
        #expect(items.map(\.id) == ["rec-1"])
    }

    @Test("An action on an item the current state no longer carries is a no-op")
    func actionOnUnknownItemIsNoOp() async {
        let gateway = FakeRecommendationGateway(items: [TodayFixtures.todayItem(id: "rec-1")])
        let model = TodayFixtures.makeModel(gateway: gateway)

        await model.load()
        await model.complete(itemId: "rec-gone")

        #expect(model.actionErrorMessage == nil)
        #expect(gateway.feedback.isEmpty)
    }
}
