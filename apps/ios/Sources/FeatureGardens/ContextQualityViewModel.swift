import CoreDomain
import CoreLocalization
import CoreNetworking
import Observation

/// View model for the Context quality screen (P9D-UX-01): one row per
/// `GardenContextKind`, the declared value, its source, and — when
/// horticulturally reviewed — who reviewed it and when.
///
/// ONLINE surface with the same `.offline`/`.failed` degraded-state posture
/// `TodayViewModel` documents — see `ContextQualityUseCases.swift` for why
/// no local projection exists.
///
/// The edit form this screen drives always sends `source: .userDeclared` —
/// `.horticulturallyReviewedDefault`/`.imported` describe how OTHER
/// pipelines populated a fact (an operator-configured regional default, or
/// a future import job), never a choice this UI offers a member, matching
/// the web sibling's own identical decision (`context-fact-edit-form.tsx`'s
/// own doc comment) and this package's own design decision (tasks/todo.md).
///
/// Source: implementation-plan.md work package P9D-UX-01;
/// packages/api-contracts/openapi.yaml, tag `GardenContext`.
@MainActor
@Observable
public final class ContextQualityViewModel {
    public private(set) var state: ContextQualityViewState = .loading
    public internal(set) var isSubmitting = false
    public internal(set) var actionErrorMessage: String?

    public let gardenId: String
    /// The caller's own role on this garden, threaded through
    /// `GardenContextQualityRoute` from `GardenSettingsView`'s already-loaded
    /// `GardenSettingsSummary.callerRole` — the same "known already, not
    /// re-fetched" reasoning `GardenCollaboratorsRoute.isOwner` documents for
    /// itself, kept as the full `GardenRole` rather than a pre-collapsed
    /// `Bool` so ``canEdit``'s two-role check stays independently testable.
    private let callerRole: GardenRole
    private let listGardenContextFacts: ListGardenContextFacts
    private let recordGardenContextFact: RecordGardenContextFact
    private let strings: LocalizedStrings

    private var factsByKind: [GardenContextKind: GardenContextFact] = [:]

    public init(
        gardenId: String,
        callerRole: GardenRole,
        listGardenContextFacts: ListGardenContextFacts,
        recordGardenContextFact: RecordGardenContextFact,
        strings: LocalizedStrings
    ) {
        self.gardenId = gardenId
        self.callerRole = callerRole
        self.listGardenContextFacts = listGardenContextFacts
        self.recordGardenContextFact = recordGardenContextFact
        self.strings = strings
    }

    /// Matrix row B14's own eligibility rule (`editGardenContent`: owner OR
    /// editor) — the identical two-role check `TasksListViewModel
    /// .eligibleAssignCandidates` already applies for the identical
    /// capability, mirrored here rather than re-derived a third way.
    public var canEdit: Bool { callerRole == .owner || callerRole == .editor }

    public var title: String { strings(.contextQualityTitle) }
    public var descriptionText: String { strings(.contextQualityDescription) }
    public var loadingMessage: String { strings(.contextQualityLoading) }
    public var retryTitle: String { strings(.contextQualityRetry) }
    public var offlineMessage: String { strings(.contextQualityOffline) }
    public var declareTitle: String { strings(.contextQualityDeclare) }
    public var editTitle: String { strings(.contextQualityEdit) }
    public var notDeclaredMessage: String { strings(.contextQualityNotDeclared) }
    public var valueLabel: String { strings(.contextQualityValueLabel) }
    public var valueRequiredMessage: String { strings(.contextQualityValueRequired) }
    public var saveTitle: String { strings(.contextQualitySave) }
    public var cancelEditTitle: String { strings(.contextQualityCancelEdit) }

    public func load() async {
        state = .loading

        do {
            let result = try await listGardenContextFacts(gardenId: gardenId)
            factsByKind = Dictionary(uniqueKeysWithValues: result.items.map { ($0.contextKind, $0) })
            state = .loaded(presentation())
        } catch let error as APIGatewayError {
            state = isTransportFailure(error) ? .offline : .failed(message: message(for: error))
        } catch {
            state = .failed(message: strings(.serverUnexpected))
        }
    }

    /// Declares or updates one context fact, then re-applies the returned
    /// fact directly into the current presentation — the same "apply the
    /// command's own response, do not re-fetch" shape
    /// `GardenSettingsViewModel.perform(_:)` uses. Returns whether the
    /// submission succeeded, so the caller (the row's own edit form) knows
    /// whether to close.
    @discardableResult
    public func record(contextKind: GardenContextKind, value: String) async -> Bool {
        isSubmitting = true
        actionErrorMessage = nil
        defer { isSubmitting = false }

        do {
            let fact = try await recordGardenContextFact(gardenId: gardenId, contextKind: contextKind, value: value)
            factsByKind[contextKind] = fact
            state = .loaded(presentation())
            return true
        } catch let error as APIGatewayError {
            actionErrorMessage = message(for: error)
            return false
        } catch {
            actionErrorMessage = strings(.serverUnexpected)
            return false
        }
    }

    /// The fixed vocabulary for `kind`, when it has one — exposed so the
    /// view's edit form can build a picker without reaching into
    /// `ContextQualityLocalization` itself (kept module-internal).
    func valueOptions(for kind: GardenContextKind) -> [ContextQualityLocalization.ValueOption]? {
        ContextQualityLocalization.valueOptions(for: kind, strings: strings)
    }

    private func presentation() -> ContextQualityPresentation {
        ContextQualityPresentation(
            rows: ContextQualityLocalization.orderedKinds.map(row),
            canEdit: canEdit
        )
    }

    private func row(for kind: GardenContextKind) -> ContextQualityRow {
        guard let fact = factsByKind[kind] else {
            return ContextQualityRow(
                id: kind,
                kindLabel: ContextQualityLocalization.kindLabel(kind, strings: strings),
                fact: nil,
                valueDisplayText: nil,
                sourceLabel: nil,
                reviewedDisplayText: nil,
                recordedByDisplayText: nil
            )
        }

        let reviewedDisplayText: String? = {
            guard
                fact.source == .horticulturallyReviewedDefault,
                let reviewedBy = fact.reviewedBy,
                let reviewedOn = fact.reviewedOn
            else {
                return nil
            }
            return strings.string(
                .contextQualityReviewedByDisplay,
                parameters: ["reviewedBy": reviewedBy, "reviewedOn": reviewedOn]
            )
        }()

        return ContextQualityRow(
            id: kind,
            kindLabel: ContextQualityLocalization.kindLabel(kind, strings: strings),
            fact: fact,
            valueDisplayText: ContextQualityLocalization.valueLabel(for: kind, value: fact.value, strings: strings)
                ?? fact.value,
            sourceLabel: ContextQualityLocalization.sourceLabel(fact.source, strings: strings),
            reviewedDisplayText: reviewedDisplayText,
            recordedByDisplayText: strings.string(
                .contextQualityRecordedByDisplay,
                parameters: ["profileId": fact.recordedByProfileId]
            )
        )
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
