import CoreDomain
import CoreLocalization
import CoreNetworking
import Foundation
import Observation

/// Answering for a walk's worth of photographs, one card at a time.
///
/// The garden is for capturing and the kitchen table is for resolving, and this
/// is the table. Reviewing fifteen suggestions one detail screen at a time is
/// the slow path — each one costs a push, a scroll, a decision and a pop — so
/// the stack puts the photograph, the guess and the two answers on one card and
/// keeps a counter.
///
/// **Nothing auto-confirms.** Every acceptance is an explicit
/// `ConfirmPlantIdentification`, which is ADR-0015 holding exactly: a swipe is a
/// decision somebody made, not the absence of one. Declining sends nothing at
/// all — the plant already exists with its photograph as its identity, and
/// "not this species" is not a server fact.
@MainActor
@Observable
public final class IdentificationReviewViewModel {
    public enum State: Equatable {
        case loading
        case reviewing([IdentificationReviewItem])
        /// Every card answered. Distinct from `.empty`, which is a garden with
        /// nothing waiting: finishing a stack deserves a different sentence
        /// from never having had one.
        case done
        case empty
        /// Structurally online-only, so this is the ordinary offline state
        /// rather than a fault — and the photographs are already saved.
        case unreachable
    }

    public private(set) var state: State = .loading
    public private(set) var answers: [String: IdentificationReviewAnswer] = [:]
    public private(set) var isSubmitting = false
    public private(set) var failureMessage: String?

    private let gardenId: String
    private let listAwaitingReview: ListPlantsAwaitingReview
    private let confirmIdentification: ConfirmPlantIdentification
    private let strings: LocalizedStrings

    public init(
        gardenId: String,
        listAwaitingReview: ListPlantsAwaitingReview,
        confirmIdentification: ConfirmPlantIdentification,
        strings: LocalizedStrings
    ) {
        self.gardenId = gardenId
        self.listAwaitingReview = listAwaitingReview
        self.confirmIdentification = confirmIdentification
        self.strings = strings
    }

    // MARK: - Loading

    public func load() async {
        do {
            let items = try await listAwaitingReview(gardenId: gardenId)
            answers = [:]
            state = items.isEmpty ? .empty : .reviewing(items)
        } catch {
            state = .unreachable
        }
    }

    // MARK: - Answering

    /// Accepting a suggestion. The command goes now rather than at the end of
    /// the stack: a person who puts the phone down halfway through has still
    /// recorded what they decided, and a batch held to the end would lose it.
    public func confirm(_ item: IdentificationReviewItem) async {
        guard item.isConfirmable else {
            skip(item)
            return
        }
        isSubmitting = true
        failureMessage = nil
        defer { isSubmitting = false }

        do {
            _ = try await confirmIdentification(
                gardenId: gardenId,
                plantId: item.plantId,
                identificationId: item.identificationId,
                expectedRevision: item.plantRevision
            )
            record(.confirm, for: item)
        } catch {
            // The card stays. A failed confirm that silently advanced would
            // leave somebody believing they had answered.
            failureMessage = strings(.reviewFailed)
        }
    }

    /// Declining. Sends nothing, by design.
    public func skip(_ item: IdentificationReviewItem) {
        record(.skip, for: item)
    }

    /// Going to look at the whole plant. Deliberately does not count as an
    /// answer — the card is still waiting when they come back.
    public func markOpened(_ item: IdentificationReviewItem) {
        answers[item.plantId] = .open
    }

    private func record(_ answer: IdentificationReviewAnswer, for item: IdentificationReviewItem) {
        answers[item.plantId] = answer
        guard case let .reviewing(items) = state else { return }
        if IdentificationReviews.remaining(in: items, answers: answers).isEmpty {
            state = .done
        }
    }

    // MARK: - Reading

    /// The card on top: the oldest unanswered one, because a walk reviewed in
    /// capture order is a walk somebody can still remember.
    public var currentItem: IdentificationReviewItem? {
        guard case let .reviewing(items) = state else { return nil }
        return IdentificationReviews.remaining(in: items, answers: answers)
            .sorted { $0.capturedAt < $1.capturedAt }
            .first
    }

    public var remainingCount: Int {
        guard case let .reviewing(items) = state else { return 0 }
        return IdentificationReviews.remaining(in: items, answers: answers).count
    }

    // MARK: - Text

    public var title: String { strings(.reviewTitle) }
    public var explanation: String { strings(.reviewExplanation) }
    public var confirmTitle: String { strings(.reviewConfirm) }
    public var skipTitle: String { strings(.reviewSkip) }
    public var openTitle: String { strings(.reviewOpenPlant) }
    public var noSuggestionText: String { strings(.reviewNoSuggestion) }
    public var doneTitle: String { strings(.reviewDoneTitle) }
    public var doneMessage: String { strings(.reviewDoneMessage) }
    public var emptyTitle: String { strings(.reviewEmptyTitle) }
    public var emptyMessage: String { strings(.reviewEmptyMessage) }
    public var offlineMessage: String { strings(.reviewOffline) }
    public var retryTitle: String { strings(.plantsListRetry) }
    public var closeTitle: String { strings(.plantsClose) }

    public var remainingText: String {
        strings.string(.reviewRemaining, parameters: ["count": String(remainingCount)])
    }

    /// A percentage as well as a bar. The bar is read at a glance; the number
    /// is what somebody quotes back when the suggestion is wrong.
    public func confidenceText(_ item: IdentificationReviewItem) -> String {
        strings.string(
            .reviewConfidence,
            parameters: [
                "percent": strings.number((item.confidence * 100).rounded(), fractionDigits: 0)
            ]
        )
    }
}
