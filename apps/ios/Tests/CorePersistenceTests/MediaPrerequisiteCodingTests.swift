import CoreDomain
import Foundation
import Testing

@testable import CorePersistence

/// Reading the media-prerequisite column, in both the shape it has now and the
/// shape it used to have.
///
/// The outbox is user-created data: every row in it is work somebody did that
/// has not reached the server yet, and ADR-0004 forbids a migration that
/// destroys it. This column grew a field — from a bare array of media ids to
/// an array of prerequisites carrying `allowsPendingUpload` — and rows written
/// before that must still decode, not silently become an empty list that
/// detaches a photograph from the observation it belongs to.
///
/// No schema migration is involved: the column is `TEXT` in both shapes, and
/// only the JSON inside it changed. That is precisely why a test is needed —
/// nothing else would notice.
@Suite("Media prerequisite column coding")
struct MediaPrerequisiteCodingTests {
    @Test("round-trips the current shape, flag included")
    func roundTripsCurrentShape() {
        let values = [
            MediaPrerequisite(mediaId: "media-1", allowsPendingUpload: true),
            MediaPrerequisite(mediaId: "media-2", allowsPendingUpload: false),
        ]
        let decoded = JSONColumnCoding.decodeMediaPrerequisites(JSONColumnCoding.encode(values))
        #expect(decoded == values)
    }

    /// The rows that were already in somebody's outbox when this shipped.
    /// They were enqueued under "media must be verified first", so that is
    /// what they must keep meaning.
    @Test("reads a legacy array of bare ids as prerequisites that must wait")
    func readsLegacyRows() {
        let legacy = #"["media-1","media-2"]"#
        let decoded = JSONColumnCoding.decodeMediaPrerequisites(legacy)

        #expect(decoded.count == 2)
        #expect(decoded.first?.mediaId == "media-1")
        #expect(decoded.allSatisfy { !$0.allowsPendingUpload })
    }

    /// The column's established contract: a malformed value is local
    /// bookkeeping gone wrong, never the sole copy of anything, so it decodes
    /// to empty rather than throwing and stranding the whole outbox.
    @Test("decodes an unreadable value to nothing rather than failing")
    func toleratesGarbage() {
        #expect(JSONColumnCoding.decodeMediaPrerequisites("not json").isEmpty)
        #expect(JSONColumnCoding.decodeMediaPrerequisites("").isEmpty)
        #expect(JSONColumnCoding.decodeMediaPrerequisites("{}").isEmpty)
    }

    /// The flag defaults to the safe direction. A command that silently
    /// applied without media it actually required would produce a record that
    /// is wrong rather than late.
    @Test("defaults to requiring the upload")
    func defaultsToRequiringUpload() {
        #expect(!MediaPrerequisite(mediaId: "media-1").allowsPendingUpload)
    }
}
