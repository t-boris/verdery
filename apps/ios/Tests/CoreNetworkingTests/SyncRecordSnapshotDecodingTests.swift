import CoreDomain
import Foundation
import Testing

@testable import CoreNetworking

/// `SyncRecordSnapshotDecoding.decode(json:)` and `SyncChangeSnapshot
/// .revision` (P5-CONFLICT-01) — the exact envelope shape `CoreDomain
/// .SyncConflict.serverRepresentation` durably stores, decoded directly from
/// raw text rather than through a full `getChanges` HTTP round trip
/// (`SyncGatewayPullTests.swift`'s own coverage of the same underlying
/// per-record-type decode, exercised through the wire instead).
@Suite("Sync record snapshot decoding")
struct SyncRecordSnapshotDecodingTests {
    @Test("decodes a garden envelope and exposes its revision")
    func decodesGardenEnvelope() throws {
        let json = #"""
            {"recordType":"garden","data":{"id":"garden-1","name":"Backyard","lifecycleState":"active",
             "callerRole":"owner","revision":9,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}}
            """#

        let snapshot = try SyncRecordSnapshotDecoding.decode(json: json)

        guard case let .garden(garden) = snapshot else {
            Issue.record("expected .garden")
            return
        }
        #expect(garden.id == "garden-1")
        #expect(snapshot.revision == 9)
    }

    @Test("decodes a gardenObject envelope and exposes its revision")
    func decodesGardenObjectEnvelope() throws {
        let json = #"""
            {"recordType":"gardenObject","data":{"id":"obj-tree","gardenId":"garden-1","category":"tree",
             "geometryEnvelope":{"geometry":{"type":"Point","coordinates":[4,4]},"coordinateSpaceId":"space-1",
             "coordinateSpaceKind":"localPlanarMetres","provenance":"manualDrawing"},"lifecycleState":"active",
             "revision":3,"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}}
            """#

        let snapshot = try SyncRecordSnapshotDecoding.decode(json: json)

        guard case let .gardenObject(object) = snapshot else {
            Issue.record("expected .gardenObject")
            return
        }
        #expect(object.id == "obj-tree")
        #expect(snapshot.revision == 3)
    }

    @Test("a record type with no typed local projection decodes to .unprojected with a nil revision")
    func decodesUnprojectedRecordType() throws {
        let snapshot = try SyncRecordSnapshotDecoding.decode(json: #"{"recordType":"calibration","data":{}}"#)

        guard case let .unprojected(recordType) = snapshot else {
            Issue.record("expected .unprojected")
            return
        }
        #expect(recordType == "calibration")
        #expect(snapshot.revision == nil)
    }

    @Test("throws when the envelope has no recordType field at all")
    func throwsWhenRecordTypeMissing() {
        #expect(throws: (any Error).self) {
            try SyncRecordSnapshotDecoding.decode(json: #"{"data":{}}"#)
        }
    }
}
