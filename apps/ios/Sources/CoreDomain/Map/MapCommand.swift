/// The canonical map editor command model.
///
/// User changes are expressed as typed commands, never as raw geometry
/// overwrites — this is what makes editing undoable, revision-guarded, and
/// identical in meaning on iOS, web, and the backend. A gesture (drag, pinch,
/// rotate handle) is a client-only concept; only the command it commits
/// crosses into durable state.
///
/// `resize`, `rotate`, and freehand `reshape` gestures all commit as
/// ``ReplaceGeometryPayload`` — the domain does not care how a client derived
/// a new shape, only what it is. Layer assignment is deliberately absent:
/// architecture/map-rendering-and-editing.md section "12. Layer Model"
/// derives layer from category and treats visibility/opacity as a
/// client-local preference, not mutable domain state.
///
/// Source: architecture/map-rendering-and-editing.md, sections
/// "7. Editor Command Model" and "9. Undo and Redo"; packages/geometry-contracts/src/command.ts.

public enum MapCommandActorType: String, Codable, Sendable, CaseIterable {
    case user
    case system
}

/// Metadata every command carries, regardless of its payload.
public struct MapCommandEnvelope: Equatable, Sendable, Codable {
    public let commandId: String
    public let gardenId: String
    public let actorProfileId: String
    public let actorType: MapCommandActorType
    public let clientTimestamp: String

    public init(
        commandId: String,
        gardenId: String,
        actorProfileId: String,
        actorType: MapCommandActorType,
        clientTimestamp: String
    ) {
        self.commandId = commandId
        self.gardenId = gardenId
        self.actorProfileId = actorProfileId
        self.actorType = actorType
        self.clientTimestamp = clientTimestamp
    }
}

/// The discriminator carried by a command payload, matching its `type` member.
public enum MapCommandType: String, Codable, Sendable, CaseIterable {
    case createObject
    case moveObject
    case replaceGeometry
    case editVertex
    case splitLinework
    case joinLinework
    case changeProperties
    case assignPlant
    case upsertCalibration
    case decideProposal
    case deleteObject
    case restoreObject
    case duplicateObject
}

/// One of the 13 kinds of change a client can commit against a garden.
///
/// Wire coding is hand-written in `MapCommandCoding.swift`: the TypeScript
/// shape is a single flat object carrying `type` plus that case's own fields
/// — never `{"type": ..., "payload": {...}}` — the same reason
/// `GeometryCoding.swift` is separate from `Geometry.swift`.
public enum MapCommandPayload: Equatable, Sendable {
    case createObject(CreateObjectPayload)
    case moveObject(MoveObjectPayload)
    case replaceGeometry(ReplaceGeometryPayload)
    case editVertex(EditVertexPayload)
    case splitLinework(SplitLineworkPayload)
    case joinLinework(JoinLineworkPayload)
    case changeProperties(ChangePropertiesPayload)
    case assignPlant(AssignPlantPayload)
    case upsertCalibration(UpsertCalibrationPayload)
    case decideProposal(DecideProposalPayload)
    case deleteObject(DeleteObjectPayload)
    case restoreObject(RestoreObjectPayload)
    case duplicateObject(DuplicateObjectPayload)

    public var type: MapCommandType {
        switch self {
        case .createObject: .createObject
        case .moveObject: .moveObject
        case .replaceGeometry: .replaceGeometry
        case .editVertex: .editVertex
        case .splitLinework: .splitLinework
        case .joinLinework: .joinLinework
        case .changeProperties: .changeProperties
        case .assignPlant: .assignPlant
        case .upsertCalibration: .upsertCalibration
        case .decideProposal: .decideProposal
        case .deleteObject: .deleteObject
        case .restoreObject: .restoreObject
        case .duplicateObject: .duplicateObject
        }
    }
}

public struct MapCommand: Equatable, Sendable, Codable {
    public let envelope: MapCommandEnvelope
    public let payload: MapCommandPayload

    public init(envelope: MapCommandEnvelope, payload: MapCommandPayload) {
        self.envelope = envelope
        self.payload = payload
    }
}
