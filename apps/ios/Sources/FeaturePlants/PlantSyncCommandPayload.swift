import CoreDomain
import CoreNetworking
import Foundation

/// The wire shape of a plant outbox operation's stored payload
/// (`OutboxOperation.payload`).
///
/// Mirrors `packages/api-contracts/openapi.yaml`'s `SyncPlantOperationPayload`
/// / `SyncPlantCommand` exactly — `recordType`, `gardenId`, and every
/// `commandType` string are the contract's own discriminator values, copied
/// verbatim, not re-derived at push time — so a later stage's real push call
/// can decode `OutboxOperation.payload` and serialize it for the wire without
/// another local migration. Every `commandType` here was checked against the
/// contract directly, the same way Stage 4a caught `gardens.delete_request`
/// (not the guessable `gardens.requestDeletion`) and Stage 4b caught
/// `recordType: "gardenObject"` (not `"mapObject"`): `plants.addPlant`,
/// `plants.updateDetails` (not `.updatePlantDetails`),
/// `plants.transitionLifecycleStage`, `plants.setStatus`, `plants.movePlant`.
///
/// Request-body wire types here (`AddPlantRequestPayload`, ...) are new,
/// feature-local structs rather than a reuse of `CoreNetworking`'s own
/// `AddPlantRequestTransport`/`UpdatePlantDetailsRequestTransport`/...: those
/// stay `internal` to `CoreNetworking` (the architecture's own "generated or
/// transport models remain behind the application gateway" rule), and unlike
/// `FeatureMap.GardenObjectSyncOperationPayload`'s reuse of
/// `MapCommandWireCoding` (a ~150-line encoding switch worth not duplicating,
/// flagged explicitly in that stage's own report), these plant request
/// bodies are small, flat structs a second field-for-field copy does not
/// meaningfully risk drifting from the contract.
///
/// Source: architecture/offline-synchronization.md, section "7. Outbox
/// Operation" ("Canonical payload"); packages/api-contracts/openapi.yaml,
/// `SyncPlantOperationPayload`, `SyncPlantCommand` and its nine branches
/// (five of which this stage builds — see `PlantsUseCases.swift`).
struct PlantSyncOperationPayload: Encodable {
    let gardenId: String
    let command: PlantSyncCommand

    private enum CodingKeys: String, CodingKey {
        case recordType, gardenId, command
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        // The contract's `SyncPlantOperationPayload.recordType` discriminator
        // — always the literal `"plant"` for this payload family.
        try container.encode("plant", forKey: .recordType)
        try container.encode(gardenId, forKey: .gardenId)
        try container.encode(command, forKey: .command)
    }
}

/// One `SyncPlantCommand` branch — the five this stage's offline commands
/// build (`AddPlant`, `UpdatePlantDetails`, `TransitionPlantLifecycleStage`,
/// `SetPlantStatus`, `MovePlant`). The other four
/// (`plants.addPlantFromPhoto`, `plants.attachPlantPhoto`,
/// `plants.setPrimaryPlantPhoto`, `plants.confirmIdentification`) have no
/// case here — see `PlantsUseCases.swift`'s doc comment for why none of the
/// four is reachable from any shipped UI today.
enum PlantSyncCommand: Encodable {
    case addPlant(plantId: String, request: AddPlantRequestPayload)
    case updateDetails(plantId: String, expectedRevision: Int, request: UpdatePlantDetailsRequestPayload)
    case transitionLifecycleStage(plantId: String, expectedRevision: Int, stage: PlantLifecycleStage)
    case setStatus(plantId: String, expectedRevision: Int, status: PlantStatus)
    case movePlant(plantId: String, expectedRevision: Int, request: MovePlantRequestPayload)

    private enum CodingKeys: String, CodingKey {
        case commandType, plantId, expectedRevision, request
    }

    private struct StageRequest: Encodable { let stage: PlantLifecycleStage }
    private struct StatusRequest: Encodable { let status: PlantStatus }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)

        switch self {
        case let .addPlant(plantId, request):
            try container.encode("plants.addPlant", forKey: .commandType)
            try container.encode(plantId, forKey: .plantId)
            try container.encode(request, forKey: .request)

        case let .updateDetails(plantId, expectedRevision, request):
            try container.encode("plants.updateDetails", forKey: .commandType)
            try container.encode(plantId, forKey: .plantId)
            try container.encode(expectedRevision, forKey: .expectedRevision)
            try container.encode(request, forKey: .request)

        case let .transitionLifecycleStage(plantId, expectedRevision, stage):
            try container.encode("plants.transitionLifecycleStage", forKey: .commandType)
            try container.encode(plantId, forKey: .plantId)
            try container.encode(expectedRevision, forKey: .expectedRevision)
            try container.encode(StageRequest(stage: stage), forKey: .request)

        case let .setStatus(plantId, expectedRevision, status):
            try container.encode("plants.setStatus", forKey: .commandType)
            try container.encode(plantId, forKey: .plantId)
            try container.encode(expectedRevision, forKey: .expectedRevision)
            try container.encode(StatusRequest(status: status), forKey: .request)

        case let .movePlant(plantId, expectedRevision, request):
            try container.encode("plants.movePlant", forKey: .commandType)
            try container.encode(plantId, forKey: .plantId)
            try container.encode(expectedRevision, forKey: .expectedRevision)
            try container.encode(request, forKey: .request)
        }
    }
}

/// Mirrors `packages/api-contracts/openapi.yaml`'s `AddPlantRequest` exactly.
struct AddPlantRequestPayload: Encodable {
    let gardenAreaMapObjectId: String?
    let placementMapObjectId: String?
    let displayName: String
    let taxonomyReferenceId: String?
    let varietyLabel: String?
    let acquisitionDate: String?
    let acquisitionDateType: PlantAcquisitionDateType?
    let groupingKind: PlantGroupingKind
    let quantity: Int?
}

/// Mirrors `packages/api-contracts/openapi.yaml`'s `UpdatePlantDetailsRequest`
/// exactly, including its `displayName`-stays-plain-optional-while-everything-
/// else-is-`FieldUpdate` shape — the identical distinction
/// `CoreNetworking.UpdatePlantDetailsRequestTransport`'s own doc comment
/// draws (the contract does not make `displayName` nullable, only omittable).
struct UpdatePlantDetailsRequestPayload: Encodable {
    let displayName: String?
    let taxonomyReferenceId: FieldUpdate<String>
    let varietyLabel: FieldUpdate<String>
    let acquisitionDate: FieldUpdate<String>
    let acquisitionDateType: FieldUpdate<PlantAcquisitionDateType>
    let conditionNote: FieldUpdate<String>
    let careGuidanceNote: FieldUpdate<String>
    let quantity: FieldUpdate<Int>

    private enum CodingKeys: String, CodingKey {
        case displayName, taxonomyReferenceId, varietyLabel, acquisitionDate
        case acquisitionDateType, conditionNote, careGuidanceNote, quantity
    }

    func encode(to encoder: any Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(displayName, forKey: .displayName)
        try container.encode(taxonomyReferenceId, forKey: .taxonomyReferenceId)
        try container.encode(varietyLabel, forKey: .varietyLabel)
        try container.encode(acquisitionDate, forKey: .acquisitionDate)
        try container.encode(acquisitionDateType, forKey: .acquisitionDateType)
        try container.encode(conditionNote, forKey: .conditionNote)
        try container.encode(careGuidanceNote, forKey: .careGuidanceNote)
        try container.encode(quantity, forKey: .quantity)
    }
}

/// Mirrors `packages/api-contracts/openapi.yaml`'s `MovePlantRequest`
/// exactly: both fields plain optionals (omittable, not `FieldUpdate` —
/// `MovePlant`'s own online signature already takes plain `String?`, not a
/// `FieldUpdate`, so this stays consistent with that established shape
/// rather than introducing a second convention for the same command).
struct MovePlantRequestPayload: Encodable {
    let gardenAreaMapObjectId: String?
    let placementMapObjectId: String?
}

enum PlantSyncCommandPayload {
    /// The command-payload version every plant outbox operation is currently
    /// authored under — see `FeatureGardens.GardenSyncCommandPayload.version`'s
    /// identical reasoning.
    static let version = 1

    /// Encodes a `PlantSyncOperationPayload` to the UTF-8 JSON text stored in
    /// `OutboxOperation.payload`.
    static func encode(gardenId: String, command: PlantSyncCommand) throws -> String {
        let payload = PlantSyncOperationPayload(gardenId: gardenId, command: command)
        let data = try JSONEncoder().encode(payload)

        guard let text = String(data: data, encoding: .utf8) else {
            throw PlantCommandError.payloadEncodingFailed
        }

        return text
    }
}
