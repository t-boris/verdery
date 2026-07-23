import CoreDomain
import CoreNetworking
import Foundation

/// Use cases for the observation history operations.
///
/// `RecordObservation`/`CorrectObservation` route through the same atomic
/// local-projection-plus-outbox pattern `FeatureGardens`'s four commands
/// (P5-IOS-02, Stage 4a), `FeatureMap`'s commands (Stage 4b), and
/// `FeaturePlants`'s five commands (Stage 4c) already established, as of
/// P5-IOS-02 Stage 4d: no network call, one GRDB transaction via
/// `LocalObservationStore.commitOfflineAppend`. `ListObservationsForGarden`/
/// `ListObservationsForPlant` stay online, gateway-backed reads — an
/// observation timeline opened while online still fetches fresh from the
/// network for display, the same way `FeaturePlants`'s `GetPlant` still
/// calls `PlantGateway` directly for reads even after Stage 4c.
///
/// **Structurally simpler than every other Stage 4 retrofit**, not just a
/// mechanical copy of Plants'/Gardens'/Map's shape: `GardenObservation` is
/// append-only by explicit domain design (see that type's own doc comment)
/// — a correction is a brand-new row, never an edit of the one it corrects.
/// Neither command here ever loads a "current" local record the way
/// `UpdatePlantDetails`/`RenameGarden`/every map command does, so neither
/// routes through a `commitOfflineMutation(id:command:)`-shaped method —
/// see `LocalObservationStore`'s own doc comment for the simpler shape this
/// stage built instead, and why. Neither command carries an
/// `expectedRevision` either, matching the domain reality that an
/// observation is never updated in place.
///
/// `photoMediaIds` is always `[]` from every use case here: attaching a
/// photo needs a `mediaId`, and this codebase has no file-upload flow yet to
/// produce one (`media.media_record` only records that a reference exists).
/// `RecordObservation`/`CorrectObservation` still work fully without a photo
/// — the contract only requires *one* of `noteText`, `conditionSummary`, or a
/// photo — so this is an honest reduction in scope, not a broken command.
///
/// Source: implementation-plan.md work package P4-IOS-01, P5-IOS-02;
/// packages/api-contracts/openapi.yaml, tag `Observations`, `Synchronization`.
public struct RecordObservation: Sendable {
    private let localStore: any LocalObservationStore
    private let profileId: String
    private let now: @Sendable () -> Date
    private let generateOperationId: @Sendable () -> String
    private let generateObservationId: @Sendable () -> String

    public init(
        localStore: any LocalObservationStore,
        profileId: String,
        now: @escaping @Sendable () -> Date = Date.init,
        generateOperationId: @escaping @Sendable () -> String = UUIDv7.generate,
        generateObservationId: @escaping @Sendable () -> String = UUIDv7.generate
    ) {
        self.localStore = localStore
        self.profileId = profileId
        self.now = now
        self.generateOperationId = generateOperationId
        self.generateObservationId = generateObservationId
    }

    public func callAsFunction(
        gardenId: String,
        plantId: String? = nil,
        gardenObjectId: String? = nil,
        noteText: String? = nil,
        conditionSummary: String? = nil,
        observedAt: Date? = nil
    ) async throws -> GardenObservation {
        let (normalizedNote, normalizedCondition) = try validatedContent(noteText: noteText, conditionSummary: conditionSummary)
        let observationId = generateObservationId()
        let timestamp = now()
        let operationId = generateOperationId()

        let observation = GardenObservation(
            id: observationId,
            gardenId: gardenId,
            plantId: plantId,
            gardenObjectId: gardenObjectId,
            actorType: .user,
            createdByProfileId: nil,
            noteText: normalizedNote,
            conditionSummary: normalizedCondition,
            correctionKind: nil,
            correctsObservationId: nil,
            isCorrected: false,
            observedAt: observedAt ?? timestamp,
            recordedAt: timestamp,
            photos: []
        )
        let operation = OutboxOperation(
            id: operationId,
            profileId: profileId,
            gardenId: gardenId,
            commandType: "observations.record",
            commandVersion: ObservationSyncCommandPayload.version,
            targetRecordIds: [observationId],
            expectedRevision: nil,
            payload: try ObservationSyncCommandPayload.encode(
                gardenId: gardenId,
                command: .record(
                    observationId: observationId,
                    request: RecordObservationRequestPayload(
                        plantId: plantId,
                        gardenObjectId: gardenObjectId,
                        noteText: normalizedNote,
                        conditionSummary: normalizedCondition,
                        observedAt: observedAt.map(ObservationTimestampFormatting.string(from:)),
                        photoMediaIds: []
                    )
                )
            ),
            createdAt: timestamp
        )

        return try await localStore.commitOfflineAppend(observation, operation: operation)
    }
}

/// Still an online, gateway-backed read — see `RecordObservation`'s doc
/// comment for the shared rationale.
public struct ListObservationsForGarden: Sendable {
    private let gateway: any ObservationGateway
    private let localStore: any LocalObservationStore

    public init(gateway: any ObservationGateway, localStore: any LocalObservationStore) {
        self.gateway = gateway
        self.localStore = localStore
    }

    /// Every observation this device has recorded or corrected purely
    /// offline for `gardenId`, not yet known to have synced — the
    /// garden-scoped counterpart to `FeatureGardens.ListGardens.cached()`/
    /// `FeaturePlants.GetPlant.cached(plantId:)`. What
    /// `ObservationsTimelineViewModel.load()` merges into this same type's
    /// own `callAsFunction(gardenId:)` result, and falls back to entirely
    /// when that call fails — see that method's own doc comment for why a
    /// merge, not a cache-first-then-overwrite like `ListGardens`'s, is what
    /// this append-only feature actually needs.
    public func pending(gardenId: String) async throws -> [GardenObservation] {
        try await localStore.fetchPending(gardenId: gardenId)
    }

    public func callAsFunction(gardenId: String) async throws -> [GardenObservation] {
        try await gateway.listObservationsForGarden(gardenId: gardenId)
    }
}

public struct ListObservationsForPlant: Sendable {
    private let gateway: any ObservationGateway

    public init(gateway: any ObservationGateway) {
        self.gateway = gateway
    }

    public func callAsFunction(gardenId: String, plantId: String) async throws -> [GardenObservation] {
        try await gateway.listObservationsForPlant(gardenId: gardenId, plantId: plantId)
    }
}

/// An "amend" or "supersede" action on an existing timeline entry — never an
/// edit of the original, which stays visible and unmodified. See
/// `RecordObservation`'s doc comment for the shared offline-routing
/// rationale.
///
/// `correctedPlantId`/`correctedGardenObjectId` are supplied by the caller,
/// not read back from local storage: unlike `UpdatePlantDetails` (which
/// loads the plant it edits from `LocalPlantStore` inside its own
/// transaction), this command has no "current" row to load at all — see
/// `LocalObservationStore`'s own doc comment. The corrected observation's
/// association is copied from whatever the caller is already displaying
/// (`ObservationsTimelineViewModel.submitCorrection` reads it straight off
/// the `ObservationRow` the user tapped "correct" on), the same value
/// `createCorrectionObservation`
/// (`observations-history/domain/observation.ts`) copies server-side from
/// `original.plantId`/`original.gardenObjectId` — so the local projection
/// this builds matches what the server will build once this operation
/// actually pushes.
public struct CorrectObservation: Sendable {
    private let localStore: any LocalObservationStore
    private let profileId: String
    private let now: @Sendable () -> Date
    private let generateOperationId: @Sendable () -> String
    private let generateObservationId: @Sendable () -> String

    public init(
        localStore: any LocalObservationStore,
        profileId: String,
        now: @escaping @Sendable () -> Date = Date.init,
        generateOperationId: @escaping @Sendable () -> String = UUIDv7.generate,
        generateObservationId: @escaping @Sendable () -> String = UUIDv7.generate
    ) {
        self.localStore = localStore
        self.profileId = profileId
        self.now = now
        self.generateOperationId = generateOperationId
        self.generateObservationId = generateObservationId
    }

    public func callAsFunction(
        gardenId: String,
        correctedObservationId: String,
        correctedPlantId: String? = nil,
        correctedGardenObjectId: String? = nil,
        correctionKind: ObservationCorrectionKind,
        noteText: String? = nil,
        conditionSummary: String? = nil
    ) async throws -> GardenObservation {
        let (normalizedNote, normalizedCondition) = try validatedContent(noteText: noteText, conditionSummary: conditionSummary)
        let observationId = generateObservationId()
        let timestamp = now()
        let operationId = generateOperationId()

        let correction = GardenObservation(
            id: observationId,
            gardenId: gardenId,
            plantId: correctedPlantId,
            gardenObjectId: correctedGardenObjectId,
            actorType: .user,
            createdByProfileId: nil,
            noteText: normalizedNote,
            conditionSummary: normalizedCondition,
            correctionKind: correctionKind,
            correctsObservationId: correctedObservationId,
            isCorrected: false,
            // Matches `createCorrectionObservation`'s own server-side
            // behavior: a correction always uses "now", never a
            // user-supplied `observedAt` — `CorrectObservationRequest` has
            // no such field (unlike `RecordObservationRequest`).
            observedAt: timestamp,
            recordedAt: timestamp,
            photos: []
        )
        let operation = OutboxOperation(
            id: operationId,
            profileId: profileId,
            gardenId: gardenId,
            commandType: "observations.correct",
            commandVersion: ObservationSyncCommandPayload.version,
            // Only the new correction row's own id — the corrected original
            // is read (conceptually, server-side), not written by this
            // operation, the same "id(s) this operation writes to, not
            // every record it references" reading `AddPlant`'s own
            // `targetRecordIds: [plantId]` already gives (that command
            // never lists `gardenAreaMapObjectId`/`placementMapObjectId`
            // either, for the same reason).
            targetRecordIds: [observationId],
            expectedRevision: nil,
            payload: try ObservationSyncCommandPayload.encode(
                gardenId: gardenId,
                command: .correct(
                    correctedObservationId: correctedObservationId,
                    observationId: observationId,
                    request: CorrectObservationRequestPayload(
                        correctionKind: correctionKind,
                        noteText: normalizedNote,
                        conditionSummary: normalizedCondition,
                        photoMediaIds: []
                    )
                )
            ),
            createdAt: timestamp
        )

        return try await localStore.commitOfflineAppend(correction, operation: operation)
    }
}

/// Trims `noteText`/`conditionSummary` and requires at least one to remain
/// non-empty after trimming — mirrors the domain's own
/// `normalizeOptionalText`/`requireObservationContent`
/// (`observations-history/domain/observation.ts`), restricted to the
/// note/condition half of that three-way rule since `photoMediaIds` is
/// always `[]` from this client (see this file's own doc comment).
private func validatedContent(
    noteText: String?,
    conditionSummary: String?
) throws -> (noteText: String?, conditionSummary: String?) {
    let normalizedNote = normalizedText(noteText)
    let normalizedCondition = normalizedText(conditionSummary)

    guard normalizedNote != nil || normalizedCondition != nil else {
        throw ObservationCommandError.invalidContent
    }

    return (normalizedNote, normalizedCondition)
}

private func normalizedText(_ text: String?) -> String? {
    guard let trimmed = text?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
        return nil
    }
    return trimmed
}
