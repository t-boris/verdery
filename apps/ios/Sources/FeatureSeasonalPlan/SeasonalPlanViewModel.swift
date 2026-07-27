import CoreDomain
import CoreLocalization
import CoreNetworking
import Foundation
import Observation

/// View model for a garden's Seasonal plan screen (P9D-UX-01): every active
/// plant's reviewed sow/transplant/harvest windows (Calendar), and the
/// continuous bed-rotation status per placed plant with a known family
/// (Rotation).
///
/// Seasonal plan is an ONLINE surface with honest offline degradation, the
/// same documented posture `TodayViewModel`'s own type comment establishes
/// for Today (see `SeasonalPlanUseCases.swift` for why):
///
/// - Offline on FIRST load: the named `.offline` state.
/// - A failed REFRESH after a successful load this session: the
///   last-fetched plan stays on screen with an explicit staleness notice
///   naming the load time (``staleNoticeText``) — honesty about staleness
///   preferred over blanking a screen the reader was just looking at.
///   In-memory only, deliberately: this screen owns no local persistence.
/// - A degraded backend on first load: the established `.failed` state.
///
/// Source: implementation-plan.md work package P9D-UX-01;
/// packages/api-contracts/openapi.yaml, tag `SeasonalPlan`.
@MainActor
@Observable
public final class SeasonalPlanViewModel {
    public private(set) var state: SeasonalPlanViewState = .loading
    /// Non-nil while the screen shows a last-fetched plan a refresh could
    /// not replace — see the degraded-states list in the type comment.
    public private(set) var staleNoticeText: String?

    public let gardenId: String
    private let loadSeasonalPlan: LoadSeasonalPlan
    private let strings: LocalizedStrings

    private var lastResult: SeasonalPlanResult?
    private var lastLoadedAt: Date?

    public init(gardenId: String, loadSeasonalPlan: LoadSeasonalPlan, strings: LocalizedStrings) {
        self.gardenId = gardenId
        self.loadSeasonalPlan = loadSeasonalPlan
        self.strings = strings
    }

    public var title: String { strings(.seasonalPlanTitle) }
    public var loadingMessage: String { strings(.seasonalPlanLoading) }
    public var retryTitle: String { strings(.seasonalPlanRetry) }
    public var offlineMessage: String { strings(.seasonalPlanOffline) }
    public var calendarTitle: String { strings(.seasonalPlanCalendarTitle) }
    public var calendarEmptyMessage: String { strings(.seasonalPlanCalendarEmpty) }
    public var hemisphereUnknownTitle: String { strings(.seasonalPlanHemisphereUnknownTitle) }
    public var hemisphereUnknownDescription: String { strings(.seasonalPlanHemisphereUnknownDescription) }
    public var hemisphereUnknownLinkTitle: String { strings(.seasonalPlanHemisphereUnknownLink) }
    public var rotationTitle: String { strings(.seasonalPlanRotationTitle) }
    public var rotationConflictsEmptyMessage: String { strings(.seasonalPlanRotationConflictsEmpty) }
    public var rotationConflictBadgeLabel: String { strings(.seasonalPlanRotationConflictBadge) }
    public var rotationShowOthersTitle: String { strings(.seasonalPlanRotationShowOthers) }
    public var rotationHideOthersTitle: String { strings(.seasonalPlanRotationHideOthers) }

    public func load() async {
        if lastResult == nil {
            state = .loading
        }

        do {
            let result = try await loadSeasonalPlan(gardenId: gardenId)
            lastResult = result
            lastLoadedAt = Date()
            staleNoticeText = nil
            state = .loaded(presentation(result))
        } catch let error as APIGatewayError {
            applyLoadFailure(offline: isTransportFailure(error), message: message(for: error))
        } catch {
            applyLoadFailure(offline: false, message: strings(.serverUnexpected))
        }
    }

    /// A failed refresh keeps the last-fetched plan on screen behind an
    /// explicit staleness notice; a failed FIRST load has nothing honest to
    /// show, so it degrades to the offline or failed state — the documented
    /// decision in the type comment.
    private func applyLoadFailure(offline: Bool, message: String) {
        if let lastLoadedAt {
            staleNoticeText = strings.string(
                .seasonalPlanStale,
                parameters: ["time": SeasonalPlanLocalization.formattedTime(lastLoadedAt)]
            )
            return
        }

        state = offline ? .offline : .failed(message: message)
    }

    private func presentation(_ result: SeasonalPlanResult) -> SeasonalPlanPresentation {
        let rotationRows = result.rotationStatus.map(rotationRow)

        return SeasonalPlanPresentation(
            hemisphereKnown: result.hemisphere != nil,
            calendarRows: result.plants.map(calendarRow),
            rotationConflicts: rotationRows.filter(\.isConflict),
            rotationOthers: rotationRows.filter { !$0.isConflict }
        )
    }

    private func calendarRow(_ entry: SeasonalPlanPlantEntry) -> SeasonalCalendarRow {
        let label = plantLabel(entry.plantId)

        switch entry.seasonalFact {
        case .noSeasonalData:
            return SeasonalCalendarRow(
                id: entry.plantId,
                plantLabel: label,
                isDeemphasized: true,
                windowLines: [],
                noteText: strings(.seasonalPlanCalendarNoSeasonalData)
            )

        case let .reviewed(timing):
            let lines = SeasonalPlanLocalization.windowLines(timing, strings: strings)
            return SeasonalCalendarRow(
                id: entry.plantId,
                plantLabel: label,
                isDeemphasized: false,
                windowLines: lines,
                noteText: lines.isEmpty ? strings(.seasonalPlanCalendarNoWindowsConfigured) : nil
            )
        }
    }

    private func rotationRow(_ entry: SeasonalPlanRotationStatusEntry) -> RotationStatusRow {
        RotationStatusRow(
            id: entry.plantId,
            plantLabel: plantLabel(entry.plantId),
            descriptionText: SeasonalPlanLocalization.describeRotationEntry(entry, strings: strings),
            isConflict: entry.withinRestPeriod
        )
    }

    /// This screen deliberately shows the raw plant id rather than a
    /// resolved display name. Web's sibling package (P9D-UX-01) built a
    /// second read-only `plantId -> displayName` lookup directly on
    /// `core/api`'s plant gateway (`features/seasonal-plan/queries.ts`'s own
    /// header) specifically because `SeasonalPlanResult` itself carries no
    /// name. The equivalent on iOS would mean giving this otherwise
    /// `FeatureHealth`/`FeatureSyncConflicts`-sized module a second gateway
    /// dependency (`CoreNetworking.PlantGateway`) and a second read pipeline
    /// purely for a label — nothing in this package's brief asks for
    /// plant-name resolution, and this codebase already has an established,
    /// precedented fallback for exactly this situation:
    /// `TodayViewModel.targetLabel`'s own `"<kind>: <id>"` raw-id fallback
    /// for a plant/garden-area target with no known display name. Reusing
    /// that same fallback shape here (`seasonalPlan.plantFallback`) is the
    /// more conservative reading of an underspecified brief — a genuine
    /// ambiguity, resolved here rather than paused on.
    private func plantLabel(_ plantId: String) -> String {
        strings.string(.seasonalPlanPlantFallback, parameters: ["plantId": plantId])
    }

    private func isTransportFailure(_ error: APIGatewayError) -> Bool {
        if case .transport = error { return true }
        return false
    }

    private func message(for failure: APIGatewayError) -> String {
        switch failure {
        case .transport:
            strings(.networkUnreachable)
        case .service, .undecodableResponse, .unexpectedStatus:
            strings(.serverUnexpected)
        }
    }
}
