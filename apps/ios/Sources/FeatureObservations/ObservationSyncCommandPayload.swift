import CoreDomain
import Foundation

/// The wire shape of an observation outbox operation's stored payload
/// (`OutboxOperation.payload`).
///
/// Mirrors `packages/api-contracts/openapi.yaml`'s
/// `SyncObservationOperationPayload` / `SyncObservationCommand` exactly —
/// `recordType`, `gardenId`, and both `commandType` strings are the
/// contract's own discriminator values, copied verbatim, not re-derived at
/// push time — so a later stage's real push call can decode
/// `OutboxOperation.payload` and serialize it for the wire without another
/// local migration. Checked directly against the contract, not guessed, the
/// same way Stage 4a caught `gardens.delete_request` (not the guessable
/// `gardens.requestDeletion`) and Stage 4c caught `plants.updateDetails`
/// (not `.updatePlantDetails`): `recordType: "observation"` (not
/// `"observations"`), `observations.record`, `observations.correct`.
/// Neither command carries an `expectedRevision` — `SyncRecordObservationCommand`/
/// `SyncCorrectObservationCommand` have no such field at all, matching the
/// domain reality that `GardenObservation` carries no revision (see that
/// type's own doc comment).
///
/// Request-body wire types here (`RecordObservationRequestPayload`,
/// `CorrectObservationRequestPayload`) are new, feature-local structs rather
/// than a reuse of `CoreNetworking`'s own `RecordObservationRequestTransport`/
/// `CorrectObservationRequestTransport`: those stay `internal` to
/// `CoreNetworking` (the architecture's own "generated or transport models
/// remain behind the application gateway" rule), and — like
/// `FeaturePlants.PlantSyncCommandPayload`'s identical choice — these
/// request bodies are small, flat structs a second field-for-field copy does
/// not meaningfully risk drifting from the contract.
///
/// Source: architecture/offline-synchronization.md, section "7. Outbox
/// Operation" ("Canonical payload"); packages/api-contracts/openapi.yaml,
/// `SyncObservationOperationPayload`, `SyncObservationCommand` and its two
/// branches.
struct ObservationSyncOperationPayload: Encodable {
    let gardenId: String
    let command: ObservationSyncCommand

    private enum CodingKeys: String, CodingKey {
        case recordType, gardenId, command
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        // The contract's `SyncObservationOperationPayload.recordType`
        // discriminator — always the literal `"observation"` for this
        // payload family (singular, matching `services/api/src/platform
        // /sync/sync-record-type.ts`'s own `Observation: 'observation'`, not
        // the plural module/feature name).
        try container.encode("observation", forKey: .recordType)
        try container.encode(gardenId, forKey: .gardenId)
        try container.encode(command, forKey: .command)
    }
}

/// One `SyncObservationCommand` branch — the two this stage's offline
/// commands build.
enum ObservationSyncCommand: Encodable {
    case record(observationId: String, request: RecordObservationRequestPayload)
    /// `correctedObservationId` is the existing row being corrected;
    /// `observationId` is the new, client-generated correction row's own id
    /// — mirrors `SyncCorrectObservationCommand`'s own two-id shape
    /// (`packages/api-contracts/openapi.yaml`'s own description: "a
    /// correction inserts a new observation row rather than editing the
    /// original, so this command has two distinct ids").
    case correct(correctedObservationId: String, observationId: String, request: CorrectObservationRequestPayload)

    private enum CodingKeys: String, CodingKey {
        case commandType, observationId, correctedObservationId, request
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)

        switch self {
        case let .record(observationId, request):
            try container.encode("observations.record", forKey: .commandType)
            try container.encode(observationId, forKey: .observationId)
            try container.encode(request, forKey: .request)

        case let .correct(correctedObservationId, observationId, request):
            try container.encode("observations.correct", forKey: .commandType)
            try container.encode(correctedObservationId, forKey: .correctedObservationId)
            try container.encode(observationId, forKey: .observationId)
            try container.encode(request, forKey: .request)
        }
    }
}

/// Mirrors `packages/api-contracts/openapi.yaml`'s `RecordObservationRequest`
/// exactly. `observedAt` is a pre-formatted RFC 3339 string, not a raw
/// `Date`: nothing else in this codebase's outbox payloads has needed to
/// encode a full timestamp yet (`FeaturePlants`'s own `acquisitionDate` is a
/// calendar-date string throughout its whole domain model, never a `Date`),
/// so `ObservationTimestampFormatting` formats it once, at the call site
/// that already has the real `Date` value, keeping this struct itself a
/// plain, default-`Encodable`-friendly shape like every other feature's
/// payload structs.
struct RecordObservationRequestPayload: Encodable {
    let plantId: String?
    let gardenObjectId: String?
    let noteText: String?
    let conditionSummary: String?
    let observedAt: String?
    let photoMediaIds: [String]
}

/// Mirrors `packages/api-contracts/openapi.yaml`'s `CorrectObservationRequest`
/// exactly. No `plantId`/`gardenObjectId` field — unlike the local
/// projection this client builds (see `CorrectObservation`'s own doc
/// comment), the wire request itself carries neither: the server derives
/// both from the observation `correctedObservationId` names
/// (`observations-history/application/correct-observation.ts`,
/// `createCorrectionObservation`).
struct CorrectObservationRequestPayload: Encodable {
    let correctionKind: ObservationCorrectionKind
    let noteText: String?
    let conditionSummary: String?
    let photoMediaIds: [String]
}

enum ObservationSyncCommandPayload {
    /// The command-payload version every observation outbox operation is
    /// currently authored under — see
    /// `FeatureGardens.GardenSyncCommandPayload.version`'s identical
    /// reasoning.
    static let version = 1

    /// Encodes an `ObservationSyncOperationPayload` to the UTF-8 JSON text
    /// stored in `OutboxOperation.payload`.
    static func encode(gardenId: String, command: ObservationSyncCommand) throws -> String {
        let payload = ObservationSyncOperationPayload(gardenId: gardenId, command: command)
        let data = try JSONEncoder().encode(payload)

        guard let text = String(data: data, encoding: .utf8) else {
            throw ObservationCommandError.payloadEncodingFailed
        }

        return text
    }
}

/// The RFC 3339 (with fractional seconds) string shape the contract's
/// `Timestamp` schema expects — the exact wire format
/// `CoreNetworking.RecordObservationRequestTransport`'s own online path
/// already sends `observedAt` as, via
/// `CoreNetworking.ISO8601DateFormatter.withFractionalSeconds`. That
/// extension is `internal` to `CoreNetworking` (not `public`), so it is not
/// reachable from here; a full second module either would have needed a
/// deliberate access-level change to a Core target for one caller, or a
/// small local duplicate. This is the latter — five lines, no domain logic,
/// and the only outbox payload across Gardens/Map/Plants/Observations that
/// needs to encode a raw timestamp at all.
enum ObservationTimestampFormatting {
    static func string(from date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }
}
