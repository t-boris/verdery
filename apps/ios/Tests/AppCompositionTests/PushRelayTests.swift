import CoreDomain
import Testing

@testable import AppComposition

/// The deep link a tapped banner carries.
///
/// `UNNotificationContent.userInfo` accepts only property-list types, so the
/// link travels as a string and is parsed back on the tap. Everything asserted
/// here is what happens when that round trip goes wrong — which it will, the
/// first time the server adds a link kind this build does not know.
@Suite("Push relay deep links")
struct PushRelayTests {
    @Test("round-trips every link this build knows")
    func roundTrip() {
        let today = NotificationDeepLink.gardenToday(
            gardenId: "garden-1",
            recommendationCandidateId: "candidate-1"
        )
        #expect(PushRelay.decode(PushRelay.encode(today)) == today)

        let export = NotificationDeepLink.exportReady(exportRequestId: "export-1")
        #expect(PushRelay.decode(PushRelay.encode(export)) == export)
    }

    /// The vocabulary is deliberately open so a new server kind never breaks a
    /// shipped client. Falling back reveals nothing and loses nothing: deep
    /// links carry resource ids and never bearer access, and the entry is still
    /// in the inbox.
    @Test("falls back rather than guessing at an unknown kind")
    func unknownKindFallsBack() {
        #expect(PushRelay.decode("somethingNew:abc") == nil)
        #expect(PushRelay.decode(PushRelay.encode(.unknown(kind: "somethingNew"))) == nil)
        #expect(PushRelay.decode("") == nil)
    }

    /// A truncated payload is a corrupt payload, and half a link is worse than
    /// none: it would open a garden with no recommendation to highlight.
    @Test("refuses a link missing part of itself")
    func truncatedLink() {
        #expect(PushRelay.decode("gardenToday:garden-1") == nil)
        #expect(PushRelay.decode("exportReady") == nil)
    }
}
