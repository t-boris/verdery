import CoreDomain
import Foundation

/// Decodes a `SyncRecordSnapshot`-shaped `{recordType, data}` JSON envelope
/// into a typed `SyncChangeSnapshot` — the exact envelope shape carried by
/// both `GET /sync/changes`'s `SyncChange.record` (pull) and
/// `POST /sync/push`'s `SyncPushOperationResult.currentRecord`, whose text is
/// what `CoreDomain.SyncConflict.serverRepresentation` durably stores (push's
/// conflict outcome).
///
/// Originally private to `URLSessionSyncGateway` (P5-IOS-03, Stage 5b, built
/// only for `getChanges`'s own decode pass). Promoted to its own public type
/// for P5-CONFLICT-01: `CoreSynchronization`'s conflict-resolution "keep
/// server version" and "duplicate as new object" actions need this exact
/// decode too, to turn a durable conflict's `serverRepresentation` back into
/// a real domain value a `SyncPullRecordApplier.applyUpsert` can accept —
/// reusing it here means neither call site duplicates `GardenTransport`/
/// `GardenObjectTransport`/`PlantTransport`/`GardenTaskTransport`'s own wire
/// decoding a second time. A free enum, not a `SyncGateway` protocol
/// requirement: decoding an already-received JSON envelope performs no
/// network I/O, so it does not belong beside `registerClient`/`push`/
/// `acknowledge`/`getChanges` on that protocol's surface, and keeping it off
/// that protocol means none of `SyncGateway`'s three test fakes need a new
/// method they would never meaningfully implement differently from the real
/// thing.
public enum SyncRecordSnapshotDecoding {
    /// Decodes the full `{recordType, data}` envelope from raw JSON text —
    /// `CoreDomain.SyncConflict.serverRepresentation`'s own shape.
    public static func decode(json: String) throws -> SyncChangeSnapshot {
        let envelope = try JSONPassthroughValue(jsonText: json)
        guard let recordType = envelope.stringValue(forKey: "recordType") else {
            throw APIGatewayError.undecodableResponse(statusCode: 200, correlationId: "")
        }
        return try decode(envelope, recordType: recordType)
    }

    /// Decodes `SyncChange.record`'s `{recordType, data}` envelope a second
    /// time, into whichever typed `*Transport` struct `recordType` names —
    /// the same structs `GardenGateway`/`MapGateway`/`PlantGateway`/
    /// `TaskGateway` already decode their own always-fresh-from-server reads
    /// into, reused here rather than duplicated, since `SyncRecordSnapshot`'s
    /// `data` schema for each record type is the exact same `Garden`/
    /// `GardenObject`/`Plant`/`Task` schema those endpoints already return.
    ///
    /// `record` arrives as `JSONPassthroughValue` — the same "flexible whole-
    /// envelope decode, then a second typed pass once the discriminator is
    /// known" shape `SyncPushOperationResultTransport.currentRecord` already
    /// uses for push's conflict payload — because `HTTPTransport.execute`'s
    /// single generic decode cannot itself branch on `recordType` the way a
    /// hand-written `init(from:)` could; re-serializing the already-parsed
    /// `data` field and decoding it again is simpler and no less correct than
    /// teaching `SyncChangeTransport` a custom keyed-container decoder for a
    /// five-way discriminated union it would otherwise need to duplicate
    /// `SyncRecordSnapshot`'s own discriminator mapping to get right.
    static func decode(_ record: JSONPassthroughValue, recordType: String) throws -> SyncChangeSnapshot {
        guard recordType == "garden" || recordType == "gardenObject" || recordType == "plant" || recordType == "task" else {
            // `calibration`/`observation`, or an unrecognized future record
            // type — no typed local projection exists to decode into; see
            // `SyncChangeSnapshot.unprojected`'s own doc comment.
            return .unprojected(recordType: recordType)
        }
        guard let dataValue = record.value(forKey: "data") else {
            throw APIGatewayError.undecodableResponse(statusCode: 200, correlationId: "")
        }
        let data = Data(try dataValue.jsonText().utf8)

        switch recordType {
        case "garden":
            let garden = try HTTPTransport.decoder.decode(GardenTransport.self, from: data)
            guard let domainValue = garden.domainValue else {
                throw APIGatewayError.undecodableResponse(statusCode: 200, correlationId: "")
            }
            return .garden(domainValue)
        case "gardenObject":
            let object = try HTTPTransport.decoder.decode(GardenObjectTransport.self, from: data)
            return .gardenObject(object.domainValue)
        case "plant":
            let plant = try HTTPTransport.decoder.decode(PlantTransport.self, from: data)
            return .plant(plant.domainValue)
        default:
            let task = try HTTPTransport.decoder.decode(GardenTaskTransport.self, from: data)
            return .task(task.domainValue)
        }
    }
}
