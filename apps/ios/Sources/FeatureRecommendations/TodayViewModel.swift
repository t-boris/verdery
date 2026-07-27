import CoreDomain
import CoreLocalization
import CoreNetworking
import Foundation
import Observation

/// View model for a garden's Today screen: the small prioritized set of
/// actionable recommendations with reason, urgency, uncertainty, and
/// controls — the phase exit criterion's own words.
///
/// Today is an ONLINE surface with honest offline degradation (see
/// `TodayUseCases.swift` for why). The degraded states, decided and
/// documented here:
///
/// - Offline on FIRST load (nothing fetched this session): a clear
///   "Today needs a connection" state (`TodayViewState.offline`) — the
///   calibration flow's precedent, never a fabricated cached view.
/// - A failed REFRESH after a successful fetch this session: the
///   last-fetched set stays on screen with an explicit staleness notice
///   naming the load time (``staleNoticeText``) — honesty about staleness
///   preferred over blanking a list the user was just reading. In-memory
///   only, deliberately: persisting Today would turn a presentation-marked,
///   server-decided lifecycle into a stale local truth.
/// - A degraded backend (5xx, undecodable, unexpected status) on first
///   load: the established failure surface (`TodayViewState.failed`).
/// - An EMPTY Today: a real loaded state the view renders as "nothing needs
///   attention", never an error.
///
/// Source: implementation-plan.md work package P7-IOS-01;
/// architecture/recommendations-and-ai.md, sections 6 and 7.
@MainActor
@Observable
public final class TodayViewModel {
    public private(set) var state: TodayViewState = .loading
    /// Non-nil while the screen shows a last-fetched set a refresh could not
    /// replace — see the degraded-states list in the type comment.
    public private(set) var staleNoticeText: String?

    // `internal(set)`, not `private(set)`: written from
    // `TodayViewModelActions.swift`'s `performItemAction`, an extension in a
    // different file — the same reason `TasksListViewModel` does this.
    public internal(set) var isPerformingAction = false
    public internal(set) var actionErrorMessage: String?
    /// Which item's postpone sheet is open, if any.
    public var postponingItemId: String?
    /// The task the latest successful conversion created — drives the
    /// "Added to tasks" confirmation and its open-tasks link, this phase's
    /// real outcome-history linkage (the converted task in the task list).
    public internal(set) var convertedTask: GardenTask?
    /// Which item ``convertedTask`` came from, so the confirmation only ever
    /// shows on that item's own detail screen — an item that left the set
    /// any other way shows the plain no-longer-in-Today notice instead.
    public internal(set) var convertedItemId: String?
    /// The item whose irrelevant-feedback confirmation is showing — the one
    /// command that deliberately changes nothing visible server-side, so a
    /// confirmation is the only honest acknowledgement.
    public internal(set) var irrelevantRecordedItemId: String?

    public let gardenId: String
    private let loadToday: LoadToday
    let completeRecommendation: CompleteRecommendation
    let postponeRecommendation: PostponeRecommendation
    let dismissRecommendation: DismissRecommendation
    let markRecommendationIrrelevant: MarkRecommendationIrrelevant
    let convertRecommendationToTask: ConvertRecommendationToTask
    let strings: LocalizedStrings

    /// Module-internal, not `private`: read by
    /// `TodayViewModelActions.swift`'s `performItemAction` for the revision
    /// each command quotes — the same reason `TasksListViewModel.tasksById`
    /// is not `private`.
    var itemsById: [String: TodayRecommendation] = [:]
    private var lastResult: TodayResult?

    public init(
        gardenId: String,
        loadToday: LoadToday,
        completeRecommendation: CompleteRecommendation,
        postponeRecommendation: PostponeRecommendation,
        dismissRecommendation: DismissRecommendation,
        markRecommendationIrrelevant: MarkRecommendationIrrelevant,
        convertRecommendationToTask: ConvertRecommendationToTask,
        strings: LocalizedStrings
    ) {
        self.gardenId = gardenId
        self.loadToday = loadToday
        self.completeRecommendation = completeRecommendation
        self.postponeRecommendation = postponeRecommendation
        self.dismissRecommendation = dismissRecommendation
        self.markRecommendationIrrelevant = markRecommendationIrrelevant
        self.convertRecommendationToTask = convertRecommendationToTask
        self.strings = strings
    }

    /// The Seasonal plan card's title/subtitle (P9D-UX-01) — resolved from
    /// `SeasonalPlanLocalizationKey`, not this feature's own key set: the
    /// same catalogue Seasonal plan's own screen reads, so the card and the
    /// screen it opens read identically. `TodayViewModel` may depend on
    /// `CoreLocalization` freely (it is a Core target); what it may NOT do
    /// is import `FeatureSeasonalPlan` itself, which is why the destination
    /// is a marker route (`TodaySeasonalPlanRoute`), not a direct view
    /// reference.
    public var seasonalPlanCardTitle: String { strings(.seasonalPlanTitle) }
    public var seasonalPlanCardSubtitle: String { strings(.seasonalPlanTodayCardSubtitle) }

    public var title: String { strings(.todayTitle) }
    public var loadingMessage: String { strings(.todayLoading) }
    public var retryTitle: String { strings(.todayRetry) }
    public var emptyMessage: String { strings(.todayEmpty) }
    public var offlineMessage: String { strings(.todayOffline) }
    public var reasonTitle: String { strings(.todayDetailReasonTitle) }
    public var priorityBreakdownTitle: String { strings(.todayDetailPriorityTitle) }
    public var evidenceTitle: String { strings(.todayDetailEvidenceTitle) }
    public var controlsTitle: String { strings(.todayDetailControlsTitle) }
    public var completeActionTitle: String { strings(.todayActionComplete) }
    public var postponeActionTitle: String { strings(.todayActionPostpone) }
    public var dismissActionTitle: String { strings(.todayActionDismiss) }
    public var markIrrelevantActionTitle: String { strings(.todayActionMarkIrrelevant) }
    public var convertActionTitle: String { strings(.todayActionConvert) }
    public var postponeUntilToggleLabel: String { strings(.todayPostponeUntilToggle) }
    public var postponeUntilLabel: String { strings(.todayPostponeUntilLabel) }
    public var postponeNoDateFootnote: String { strings(.todayPostponeNoDateFootnote) }
    public var postponeSubmitTitle: String { strings(.todayPostponeSubmit) }
    public var cancelTitle: String { strings(.todayCancel) }
    public var openTasksTitle: String { strings(.todayConvertedOpenTasks) }
    public var irrelevantRecordedMessage: String { strings(.todayIrrelevantRecorded) }
    public var goneMessage: String { strings(.todayDetailGone) }

    public var convertedMessage: String? {
        convertedTask.map { strings.string(.todayConvertedMessage, parameters: ["title": $0.title]) }
    }

    public func load() async {
        if lastResult == nil {
            state = .loading
        }

        do {
            let result = try await loadToday(gardenId: gardenId)
            lastResult = result
            staleNoticeText = nil
            itemsById = Dictionary(uniqueKeysWithValues: result.items.map { ($0.id, $0) })
            state = .loaded(result.items.map(presentation))
        } catch let error as APIGatewayError {
            applyLoadFailure(offline: isTransportFailure(error), message: message(for: error))
        } catch {
            applyLoadFailure(offline: false, message: strings(.serverUnexpected))
        }
    }

    /// A failed refresh keeps the last-fetched set on screen behind an
    /// explicit staleness notice; a failed FIRST load has nothing honest to
    /// show, so it degrades to the offline or failed state — the documented
    /// decision in the type comment.
    private func applyLoadFailure(offline: Bool, message: String) {
        if let lastResult {
            staleNoticeText = strings.string(
                .todayStale,
                parameters: ["time": TodayLocalization.formattedTime(lastResult.generatedAt)]
            )
            return
        }

        state = offline ? .offline : .failed(message: message)
    }

    private func presentation(_ item: TodayRecommendation) -> TodayItemPresentation {
        let recommendation = item.recommendation
        let confidenceFactor = item.priorityFactors.first { $0.kind == .confidence }

        return TodayItemPresentation(
            id: item.id,
            actionTitle: item.actionTitle,
            targetLabel: targetLabel(for: item),
            explanation: recommendation.explanation,
            urgencyLabel: TodayLocalization.urgencyName(recommendation.urgency, strings: strings),
            urgency: recommendation.urgency,
            careCategory: recommendation.careCategory,
            windowText: TodayLocalization.windowText(
                start: recommendation.windowStart,
                end: recommendation.windowEnd,
                strings: strings
            ),
            priorityScoreText: strings.string(.todayPriorityScore, parameters: ["score": String(item.priorityScore)]),
            uncertaintyText: confidenceFactor.map { TodayLocalization.factorLine($0, strings: strings) },
            isElevatedRisk: recommendation.safetyTier == .elevatedRisk,
            safetyTierLabel: strings(TodayLocalization.key(for: recommendation.safetyTier)),
            factorLines: item.priorityFactors.map { TodayLocalization.factorLine($0, strings: strings) },
            evidenceLines: item.evidence.map { entry in
                TodayEvidenceLine(
                    id: entry.id,
                    kindLabel: strings(TodayLocalization.key(for: entry.kind)),
                    factText: TodayLocalization.evidenceFactText(entry)
                )
            },
            revision: recommendation.revision
        )
    }

    private func targetLabel(for item: TodayRecommendation) -> String {
        if let name = item.targetDisplayName {
            return name
        }

        switch item.recommendation.targetKind {
        case .garden:
            return strings(.todayTargetGarden)
        case .gardenArea:
            // No launch rule produces an area target and the server returns
            // no display name for one yet (a documented scope boundary) —
            // the raw id is the honest fallback, `TasksListViewModel
            // .targetLabel`'s own convention.
            let id = item.recommendation.targetGardenAreaMapObjectId ?? ""
            return "\(strings(.tasksTargetKindGardenArea)): \(id)"
        case .plant:
            let id = item.recommendation.targetPlantId ?? ""
            return "\(strings(.tasksTargetKindPlant)): \(id)"
        }
    }

    func isTransportFailure(_ error: APIGatewayError) -> Bool {
        if case .transport = error { return true }
        return false
    }

    func message(for failure: APIGatewayError) -> String {
        switch failure {
        case .transport:
            strings(.networkUnreachable)
        case .service, .undecodableResponse, .unexpectedStatus:
            strings(.serverUnexpected)
        }
    }
}
