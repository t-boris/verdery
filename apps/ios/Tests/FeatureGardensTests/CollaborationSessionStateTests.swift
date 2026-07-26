import Foundation
import Testing

@testable import FeatureGardens

@Suite("Collaboration session state")
@MainActor
struct CollaborationSessionStateTests {
    @Test("An invite deep link sets the pending token")
    func inviteDeepLink() throws {
        let state = CollaborationSessionState()
        let url = try #require(URL(string: "verdery://invite?token=abc123"))

        #expect(state.handleDeepLink(url))
        #expect(state.pendingInvitationToken == "abc123")
    }

    @Test("clearPendingInvitation removes the token")
    func clearsPendingInvitation() throws {
        let state = CollaborationSessionState()
        _ = state.handleDeepLink(try #require(URL(string: "verdery://invite?token=abc123")))

        state.clearPendingInvitation()

        #expect(state.pendingInvitationToken == nil)
    }

    @Test("An ownership-transfer deep link marks that garden's incoming hint")
    func ownershipTransferDeepLink() throws {
        let state = CollaborationSessionState()
        let url = try #require(URL(string: "verdery://ownership-transfer?gardenId=garden-9"))

        #expect(state.handleDeepLink(url))
        #expect(state.hasIncomingTransferHint(gardenId: "garden-9"))
        #expect(!state.hasIncomingTransferHint(gardenId: "garden-other"))
    }

    @Test("clearIncomingTransferHint removes only the named garden's hint")
    func clearsOneGardenOnly() throws {
        let state = CollaborationSessionState()
        _ = state.handleDeepLink(try #require(URL(string: "verdery://ownership-transfer?gardenId=garden-1")))
        _ = state.handleDeepLink(try #require(URL(string: "verdery://ownership-transfer?gardenId=garden-2")))

        state.clearIncomingTransferHint(gardenId: "garden-1")

        #expect(!state.hasIncomingTransferHint(gardenId: "garden-1"))
        #expect(state.hasIncomingTransferHint(gardenId: "garden-2"))
    }

    @Test("A URL with a foreign scheme is ignored")
    func foreignSchemeIgnored() throws {
        let state = CollaborationSessionState()
        let url = try #require(URL(string: "https://example.com/invite?token=abc123"))

        #expect(!state.handleDeepLink(url))
        #expect(state.pendingInvitationToken == nil)
    }

    @Test("A recognized scheme with an unknown host is ignored")
    func unknownHostIgnored() throws {
        let state = CollaborationSessionState()
        let url = try #require(URL(string: "verdery://something-else?token=abc123"))

        #expect(!state.handleDeepLink(url))
    }

    @Test("An invite link with no token is ignored")
    func missingTokenIgnored() throws {
        let state = CollaborationSessionState()
        let url = try #require(URL(string: "verdery://invite"))

        #expect(!state.handleDeepLink(url))
        #expect(state.pendingInvitationToken == nil)
    }

    @Test("setIncomingTransfers replaces the cached poll result wholesale")
    func setIncomingTransfersReplacesCache() {
        let state = CollaborationSessionState()
        let first = fakeIncomingOwnershipTransfer(id: "transfer-1", gardenId: "garden-1")
        let second = fakeIncomingOwnershipTransfer(id: "transfer-2", gardenId: "garden-2")

        state.setIncomingTransfers([first])
        #expect(state.incomingTransfers == [first])
        #expect(state.incomingTransfer(gardenId: "garden-1") == first)
        #expect(state.incomingTransfer(gardenId: "garden-2") == nil)

        state.setIncomingTransfers([second])
        #expect(state.incomingTransfers == [second])
        #expect(state.incomingTransfer(gardenId: "garden-1") == nil, "The previous poll result is superseded, not merged")
        #expect(state.incomingTransfer(gardenId: "garden-2") == second)
    }

    @Test("incomingTransfer(gardenId:) is nil before any poll has completed")
    func incomingTransferNilBeforePoll() {
        let state = CollaborationSessionState()

        #expect(state.incomingTransfers.isEmpty)
        #expect(state.incomingTransfer(gardenId: "garden-1") == nil)
    }
}
