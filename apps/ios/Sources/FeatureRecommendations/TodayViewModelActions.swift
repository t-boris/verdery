import CoreDomain
import CoreNetworking
import Foundation

/// Item-level controls: complete, postpone (with the user's optional
/// horizon), dismiss, mark-irrelevant, and convert-to-task — each quoting
/// the item's current revision as `If-Match` and refreshing the list from
/// the server afterwards, because every outcome here (the item leaving
/// Today, a successor appearing later, the converted task's creation) is
/// server-decided state this surface only ever mirrors.
///
/// A revision-guard rejection (409/412 — someone else acted on the
/// candidate, or a sweep expired/superseded it in the same moment) is a
/// legitimate race the backend documents, not a defect: it surfaces as its
/// own message and triggers a refresh so the next attempt starts from the
/// current state.
extension TodayViewModel {
    public func complete(itemId: String) async {
        await performItemAction(itemId: itemId) { [self] item in
            _ = try await completeRecommendation(
                gardenId: gardenId,
                recommendationId: itemId,
                expectedRevision: item.recommendation.revision
            )
        }
    }

    public func submitPostpone(itemId: String, until: Date?) async {
        await performItemAction(itemId: itemId) { [self] item in
            _ = try await postponeRecommendation(
                gardenId: gardenId,
                recommendationId: itemId,
                postponedUntil: until,
                expectedRevision: item.recommendation.revision
            )
        }
        if actionErrorMessage == nil {
            postponingItemId = nil
        }
    }

    public func dismiss(itemId: String) async {
        await performItemAction(itemId: itemId) { [self] item in
            _ = try await dismissRecommendation(
                gardenId: gardenId,
                recommendationId: itemId,
                expectedRevision: item.recommendation.revision
            )
        }
    }

    /// The one command with no lifecycle transition and no revision bump —
    /// the candidate stays exactly as it was, so nothing is refreshed and
    /// the only honest acknowledgement is the recorded-feedback notice.
    public func markIrrelevant(itemId: String) async {
        await performItemAction(itemId: itemId, refreshAfterSuccess: false) { [self] item in
            _ = try await markRecommendationIrrelevant(
                gardenId: gardenId,
                recommendationId: itemId,
                expectedRevision: item.recommendation.revision
            )
        }
        if actionErrorMessage == nil {
            irrelevantRecordedItemId = itemId
        }
    }

    public func convert(itemId: String) async {
        await performItemAction(itemId: itemId) { [self] item in
            let result = try await convertRecommendationToTask(
                gardenId: gardenId,
                recommendationId: itemId,
                expectedRevision: item.recommendation.revision
            )
            convertedTask = result.task
            convertedItemId = itemId
        }
    }

    private func performItemAction(
        itemId: String,
        refreshAfterSuccess: Bool = true,
        _ action: (TodayRecommendation) async throws -> Void
    ) async {
        guard let item = itemsById[itemId] else { return }

        isPerformingAction = true
        actionErrorMessage = nil
        irrelevantRecordedItemId = nil
        defer { isPerformingAction = false }

        do {
            try await action(item)
            if refreshAfterSuccess {
                await load()
            }
        } catch let error as APIGatewayError {
            actionErrorMessage = actionMessage(for: error)
            if isRevisionConflict(error) {
                // The candidate is no longer what this screen showed —
                // refresh so the message's "current state" is on screen.
                await load()
            }
        } catch {
            actionErrorMessage = strings(.serverUnexpected)
        }
    }

    private func actionMessage(for error: APIGatewayError) -> String {
        if isRevisionConflict(error) {
            return strings(.todayConflict)
        }
        return message(for: error)
    }

    /// `409 Conflict` (already idempotently acted on with a different key,
    /// or state no longer legal) and `412 Precondition Failed` (revision
    /// guard) both mean "the server's candidate moved past what this screen
    /// shows" — one refresh-and-retry surface, matching the contract's own
    /// declared responses on every feedback command.
    private func isRevisionConflict(_ error: APIGatewayError) -> Bool {
        if case let .service(_, statusCode, _) = error {
            return statusCode == 409 || statusCode == 412
        }
        return false
    }
}
