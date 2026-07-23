import CorePersistence
import CoreDomain
import CoreLocalization
import CoreSynchronization
import Observation

/// View model for one garden's sync conflicts screen — the reachable UI
/// architecture/ios-application-design.md, section "8. Synchronization
/// Integration" leaves as a named gap ("Conflict details and recovery
/// actions are persisted so they survive application restart") and
/// P5-CONFLICT-01 wires up: list the garden's open, durable conflicts, let
/// the user open one for a side-by-side compare, and dispatch one of the
/// conflict's own `suggestedRecoveryActions`.
///
/// Deliberately reads `SyncConflictStore.fetchOpen(gardenId:)` directly
/// (the durable, persisted source of truth) rather than depending on
/// `CoreSynchronization.SyncEngineStatus.requiresAttention`: that status is
/// a coarser, EPHEMERAL, per-engine-instance signal for "the last push/pull
/// cycle itself failed" (auth/validation/undecodable-response —
/// `SyncEngineStatus.requiresAttention`'s own doc comment), not "this garden
/// has an open conflict" — a conflict can be open with the engine otherwise
/// perfectly healthy (every other pending operation pushed fine), and
/// `requiresAttention` can be true with zero open conflicts (a genuine
/// validation failure on an unrelated operation). The two are real,
/// orthogonal conditions; conflating them would either hide a real open
/// conflict behind a `requiresAttention == false` engine reading from a
/// difference instance, or show this screen for a condition it cannot
/// actually act on. Reading the durable store directly is also why this
/// screen stays fully functional after a process relaunch, before any
/// engine instance has run a cycle at all — exactly what "survive
/// application restart" requires.
@MainActor
@Observable
public final class SyncConflictsViewModel {
    public private(set) var state: SyncConflictsViewState = .loading
    /// Drives the compare/detail sheet — `nil` when none is presented.
    /// `select(_:)`/`dismissDetail()` are this view model's own navigation
    /// surface: `openForManualReview` (section "15. Local Conflict
    /// Recovery") is exactly "present both representations," which is what
    /// showing this sheet already does — there is no separate resolution
    /// call for it.
    public private(set) var selectedConflict: SyncConflict?
    public private(set) var isResolving = false
    public private(set) var resolutionErrorMessage: String?

    public let gardenId: String
    private let conflictStore: any SyncConflictStore
    private let engine: any ConflictResolvingSyncEngine
    private let strings: LocalizedStrings

    public init(
        gardenId: String,
        conflictStore: any SyncConflictStore,
        engine: any ConflictResolvingSyncEngine,
        strings: LocalizedStrings
    ) {
        self.gardenId = gardenId
        self.conflictStore = conflictStore
        self.engine = engine
        self.strings = strings
    }

    public var title: String { strings(.syncConflictsTitle) }
    public var emptyMessage: String { strings(.syncConflictsEmpty) }
    public var conflictCodeLabel: String { strings(.syncConflictsConflictCodeLabel) }
    public var localRepresentationLabel: String { strings(.syncConflictsLocalLabel) }
    public var serverRepresentationLabel: String { strings(.syncConflictsServerLabel) }
    public var closeTitle: String { strings(.syncConflictsClose) }

    public func load() async {
        state = .loading
        do {
            state = .loaded(try await conflictStore.fetchOpen(gardenId: gardenId))
        } catch {
            state = .failed(message: strings(.syncConflictsFailed))
        }
    }

    /// Opens `conflict` for compare/resolve — `openForManualReview`'s own
    /// presentation, see this type's own doc comment.
    public func select(_ conflict: SyncConflict) {
        resolutionErrorMessage = nil
        selectedConflict = conflict
    }

    public func dismissDetail() {
        selectedConflict = nil
    }

    /// Localized title for one of `conflict.suggestedRecoveryActions` — the
    /// detail view builds one button per offered action from this, never
    /// hardcoding which actions exist for which conflict itself
    /// (`ConflictRecoveryPolicy`, `CoreSynchronization`, already decided
    /// that when the conflict was recorded).
    public func title(for action: ConflictRecoveryAction) -> String {
        switch action {
        case .keepServerVersion: strings(.syncConflictsActionKeepServer)
        case .reapplyLocalIntent: strings(.syncConflictsActionReapply)
        case .duplicateAsNewObject: strings(.syncConflictsActionDuplicate)
        case .openForManualReview: strings(.syncConflictsActionReview)
        }
    }

    /// Dispatches one of `conflict.suggestedRecoveryActions` —
    /// `.openForManualReview` never reaches here: `select(_:)`/the sheet it
    /// drives is already this app's presentation of that action, so the
    /// detail view never builds a button for it in the first place (see
    /// `title(for:)`'s own doc comment); `ConflictResolvingSyncEngine
    /// .resolveConflict(_:action:)` would reject it defensively regardless.
    /// Reloads the open-conflict list and dismisses the sheet on success —
    /// `reapplyLocalIntent`/`duplicateAsNewObject` leave the conflict
    /// resolved-but-not-yet-removed (it stops being "open" immediately, per
    /// `SyncConflictStore.resolve(conflictId:resolutionOperationId:at:)`),
    /// so it already disappears from this reload without this view model
    /// needing to know that two-step timing itself.
    public func resolve(_ conflict: SyncConflict, action: ConflictRecoveryAction) async {
        isResolving = true
        resolutionErrorMessage = nil
        defer { isResolving = false }

        do {
            try await engine.resolveConflict(conflict, action: action)
            selectedConflict = nil
            await load()
        } catch {
            resolutionErrorMessage = strings(.syncConflictsFailed)
        }
    }
}
