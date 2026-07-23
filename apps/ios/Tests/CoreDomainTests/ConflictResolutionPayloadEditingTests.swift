import Testing

@testable import CoreDomain

/// Pure-value-type behavior for `ConflictResolutionPayloadEditing`
/// (P5-CONFLICT-01) — no persistence, no I/O.
@Suite("Conflict resolution payload editing")
struct ConflictResolutionPayloadEditingTests {
    private enum FakeError: Error, Equatable {
        case malformed
    }

    @Test("replaces only command.expectedRevision, leaving every other field untouched")
    func replacesOnlyExpectedRevision() throws {
        let payload = #"{"recordType":"gardenObject","gardenId":"garden-1","command":{"type":"moveObject","objectId":"obj-1","expectedRevision":3,"translationMetres":{"dx":1.5,"dy":-2}}}"#

        let rewritten = try ConflictResolutionPayloadEditing.replacingExpectedRevision(
            in: payload, with: 9, orThrow: FakeError.malformed
        )

        #expect(rewritten.contains(#""expectedRevision":9"#))
        #expect(rewritten.contains(#""dx":1.5"#))
        #expect(rewritten.contains(#""objectId":"obj-1""#))
        #expect(rewritten.contains(#""recordType":"gardenObject""#))
        #expect(!rewritten.contains(#""expectedRevision":3"#))
    }

    @Test("throws the caller's own error when the payload is not a JSON object")
    func throwsOnNonObjectPayload() {
        #expect(throws: FakeError.malformed) {
            try ConflictResolutionPayloadEditing.replacingExpectedRevision(in: "not json", with: 1, orThrow: FakeError.malformed)
        }
    }

    @Test("throws the caller's own error when there is no command object")
    func throwsWhenNoCommandObject() {
        #expect(throws: FakeError.malformed) {
            try ConflictResolutionPayloadEditing.replacingExpectedRevision(
                in: #"{"recordType":"garden"}"#, with: 1, orThrow: FakeError.malformed
            )
        }
    }

    @Test("throws the caller's own error when command has no expectedRevision key at all — a create command")
    func throwsWhenNoExpectedRevisionKey() {
        let createPayload = #"{"recordType":"gardenObject","gardenId":"garden-1","command":{"type":"createObject","objectId":"obj-1"}}"#

        #expect(throws: FakeError.malformed) {
            try ConflictResolutionPayloadEditing.replacingExpectedRevision(in: createPayload, with: 1, orThrow: FakeError.malformed)
        }
    }
}
