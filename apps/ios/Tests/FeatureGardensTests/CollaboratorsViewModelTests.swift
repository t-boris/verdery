import CoreDomain
import CoreLocalization
import CoreNetworking
import Foundation
import Testing

@testable import FeatureGardens

@Suite("Collaborators view model")
@MainActor
struct CollaboratorsViewModelTests {
    private let strings = LocalizedStrings(locale: Locale(identifier: "en_GB"))

    private func makeModel(
        gateway: FakeCollaborationGateway,
        gardenId: String = "garden-1",
        isOwner: Bool = true
    ) -> CollaboratorsViewModel {
        CollaboratorsViewModel(
            gardenId: gardenId,
            isOwner: isOwner,
            listMembers: ListGardenMembers(gateway: gateway),
            createInvitation: CreateGardenInvitation(gateway: gateway),
            listInvitations: ListGardenInvitations(gateway: gateway),
            revokeInvitation: RevokeGardenInvitation(gateway: gateway),
            changeMemberRole: ChangeGardenMemberRole(gateway: gateway),
            removeMember: RemoveGardenMember(gateway: gateway),
            promoteMember: PromoteGardenMember(gateway: gateway),
            demoteOwner: DemoteGardenOwner(gateway: gateway),
            requestTransfer: RequestGardenOwnershipTransfer(gateway: gateway),
            cancelOwnershipTransfer: CancelGardenOwnershipTransfer(gateway: gateway),
            fetchOwnershipTransfer: FetchGardenOwnershipTransfer(gateway: gateway),
            strings: strings
        )
    }

    // MARK: Loading

    @Test("load() lists members for every role, and invitations only for an owner")
    func loadShowsInvitationsOnlyForOwner() async throws {
        let gateway = FakeCollaborationGateway()
        gateway.members = [fakeGardenMember(profileId: "profile-1", role: .editor)]
        gateway.invitations = [fakeGardenInvitation()]

        let ownerModel = makeModel(gateway: gateway, isOwner: true)
        await ownerModel.load()
        guard case let .loaded(ownerSummary) = ownerModel.state else {
            Issue.record("Expected .loaded")
            return
        }
        #expect(ownerSummary.members.count == 1)
        #expect(ownerSummary.invitations.count == 1)
        #expect(ownerSummary.isOwner)

        let viewerModel = makeModel(gateway: gateway, isOwner: false)
        await viewerModel.load()
        guard case let .loaded(viewerSummary) = viewerModel.state else {
            Issue.record("Expected .loaded")
            return
        }
        #expect(viewerSummary.members.count == 1)
        #expect(viewerSummary.invitations.isEmpty)
    }

    @Test("load() fetches the garden's pending ownership transfer for an owner, and survives a relaunch")
    func loadFetchesOutgoingTransferForOwnerOnly() async throws {
        let gateway = FakeCollaborationGateway()
        gateway.fetchGardenOwnershipTransferResult = .success(fakeOwnershipTransfer(gardenId: "garden-1"))

        // A fresh view model with no prior in-memory state — the same as
        // after an app relaunch — still shows the pending transfer, because
        // it is read from the server rather than a session-scoped cache
        // seeded only by the mutation that created it (P9A-OWNER-02).
        let ownerModel = makeModel(gateway: gateway, isOwner: true)
        await ownerModel.load()
        #expect(ownerModel.outgoingTransfer?.gardenId == "garden-1")
        #expect(gateway.fetchGardenOwnershipTransferCalls == ["garden-1"])

        let viewerModel = makeModel(gateway: gateway, isOwner: false)
        await viewerModel.load()
        #expect(viewerModel.outgoingTransfer == nil)
        #expect(gateway.fetchGardenOwnershipTransferCalls == ["garden-1"], "A non-owner never fetches it at all")
    }

    @Test("A roster entry never carries a name — only the generic placeholder and its role")
    func rosterEntryHasNoName() async throws {
        let gateway = FakeCollaborationGateway()
        gateway.members = [fakeGardenMember(role: .viewer)]
        let model = makeModel(gateway: gateway, isOwner: false)

        await model.load()

        guard case let .loaded(summary) = model.state else {
            Issue.record("Expected .loaded")
            return
        }
        let row = try #require(summary.members.first)
        #expect(row.nameLabel == strings(.collaborationMemberGeneric))
        #expect(row.roleLabel == strings(.gardensRoleViewer))
    }

    @Test("load() failure surfaces a localized message")
    func loadFailureSurfacesMessage() async throws {
        // A gateway whose every operation throws — simplest way to force
        // `listMembers` itself to fail, which `FakeCollaborationGateway`
        // does not model (its `listMembers` never fails).
        let failingGateway = ThrowingCollaborationGateway()
        let model = CollaboratorsViewModel(
            gardenId: "garden-1", isOwner: false,
            listMembers: ListGardenMembers(gateway: failingGateway),
            createInvitation: CreateGardenInvitation(gateway: failingGateway),
            listInvitations: ListGardenInvitations(gateway: failingGateway),
            revokeInvitation: RevokeGardenInvitation(gateway: failingGateway),
            changeMemberRole: ChangeGardenMemberRole(gateway: failingGateway),
            removeMember: RemoveGardenMember(gateway: failingGateway),
            promoteMember: PromoteGardenMember(gateway: failingGateway),
            demoteOwner: DemoteGardenOwner(gateway: failingGateway),
            requestTransfer: RequestGardenOwnershipTransfer(gateway: failingGateway),
            cancelOwnershipTransfer: CancelGardenOwnershipTransfer(gateway: failingGateway),
            fetchOwnershipTransfer: FetchGardenOwnershipTransfer(gateway: failingGateway),
            strings: strings
        )

        await model.load()

        guard case let .failed(message) = model.state else {
            Issue.record("Expected .failed")
            return
        }
        #expect(message == strings(.serverUnexpected))
    }

    // MARK: Invite

    @Test("submitInvite() success holds the one-time token and builds a verdery:// deep link")
    func submitInviteSucceeds() async throws {
        let gateway = FakeCollaborationGateway()
        let created = CreatedGardenInvitation(invitation: fakeGardenInvitation(intendedEmail: nil), token: "raw-token-value")
        gateway.createInvitationResult = .success(created)
        let model = makeModel(gateway: gateway)
        model.inviteRole = .viewer
        model.inviteEmail = "  "

        await model.submitInvite()

        #expect(model.createdInvitation?.token == "raw-token-value")
        #expect(model.inviteErrorMessage == nil)
        let call = try #require(gateway.createInvitationCalls.first)
        #expect(call.role == .viewer)
        #expect(call.email == nil, "A blank email is trimmed to nil, not sent as an empty string")

        let link = try #require(model.createdInvitationShareURL)
        #expect(link.scheme == "verdery")
        #expect(link.host == "invite")
        #expect(URLComponents(url: link, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "token" })?.value == "raw-token-value")
    }

    @Test("submitInvite() failure (already pending) surfaces the specific localized message")
    func submitInviteAlreadyPending() async throws {
        let gateway = FakeCollaborationGateway()
        gateway.createInvitationResult = .failure(fakeServiceError(code: CollaborationErrorCode.invitationAlreadyPending, statusCode: 409))
        let model = makeModel(gateway: gateway)

        await model.submitInvite()

        #expect(model.createdInvitation == nil)
        #expect(model.inviteErrorMessage == strings(.collaborationErrorInvitationAlreadyPending))
    }

    // MARK: Role administration

    @Test("confirmChangeRole calls the gateway with the chosen role and refreshes the roster")
    func confirmChangeRoleSucceeds() async throws {
        let gateway = FakeCollaborationGateway()
        gateway.members = [fakeGardenMember(profileId: "profile-1", role: .editor)]
        gateway.changeMemberRoleResult = .success(fakeGardenMember(profileId: "profile-1", role: .viewer))
        let model = makeModel(gateway: gateway, isOwner: true)
        await model.load()

        await model.confirmChangeRole(profileId: "profile-1", role: .viewer)

        #expect(model.pendingAction == nil)
        #expect(model.actionErrorMessage == nil)
        let call = try #require(gateway.changeMemberRoleCalls.first)
        #expect(call.profileId == "profile-1")
        #expect(call.role == .viewer)
    }

    @Test("confirmPromote requiring recent authentication surfaces the specific message")
    func confirmPromoteRecentAuthRequired() async throws {
        let gateway = FakeCollaborationGateway()
        gateway.promoteMemberResult = .failure(fakeServiceError(code: CollaborationErrorCode.recentAuthenticationRequired, statusCode: 403))
        let model = makeModel(gateway: gateway)

        await model.confirmPromote(profileId: "profile-1")

        #expect(model.actionErrorMessage == strings(.collaborationErrorRecentAuthRequired))
    }

    @Test("confirmDemote sends the chosen resulting role")
    func confirmDemoteSendsChosenRole() async throws {
        let gateway = FakeCollaborationGateway()
        gateway.demoteOwnerResult = .success(fakeGardenMember(role: .viewer))
        let model = makeModel(gateway: gateway)

        await model.confirmDemote(profileId: "profile-1", role: .viewer)

        let call = try #require(gateway.demoteOwnerCalls.first)
        #expect(call.role == .viewer)
    }

    @Test("confirmDemote refused as the last owner surfaces the specific message")
    func confirmDemoteLastOwnerRequired() async throws {
        let gateway = FakeCollaborationGateway()
        gateway.demoteOwnerResult = .failure(fakeServiceError(code: CollaborationErrorCode.lastOwnerRequired, statusCode: 422))
        let model = makeModel(gateway: gateway)

        await model.confirmDemote(profileId: "profile-1", role: .editor)

        #expect(model.actionErrorMessage == strings(.collaborationErrorLastOwnerRequired))
    }

    @Test("confirmRemove calls the gateway for the targeted profile")
    func confirmRemoveSucceeds() async throws {
        let gateway = FakeCollaborationGateway()
        gateway.removeMemberResult = .success(fakeGardenMember(profileId: "profile-2"))
        let model = makeModel(gateway: gateway)

        await model.confirmRemove(profileId: "profile-2")

        #expect(gateway.removeMemberCalls.first?.profileId == "profile-2")
        #expect(model.actionErrorMessage == nil)
    }

    // MARK: Ownership transfer

    @Test("confirmTransferOwnership refreshes from the server and reflects the newly pending transfer")
    func confirmTransferOwnershipRefreshesOutgoingTransfer() async throws {
        let gateway = FakeCollaborationGateway()
        let transfer = fakeOwnershipTransfer(gardenId: "garden-1", toProfileId: "profile-2", fromResultingRole: .viewer)
        gateway.transferOwnershipResult = .success(transfer)
        // `confirmTransferOwnership` no longer seeds this from the mutation's
        // own response (P9A-OWNER-02): `reload()` re-fetches it for real.
        gateway.fetchGardenOwnershipTransferResult = .success(transfer)
        let model = makeModel(gateway: gateway, gardenId: "garden-1")

        await model.confirmTransferOwnership(profileId: "profile-2", resultingRole: .viewer)

        #expect(model.outgoingTransfer == transfer)
        let call = try #require(gateway.transferOwnershipCalls.first)
        #expect(call.toProfileId == "profile-2")
        #expect(call.resultingRole == .viewer)
    }

    @Test("confirmCancelTransfer refreshes from the server and reflects that nothing is pending anymore")
    func confirmCancelTransferRefreshesOutgoingTransfer() async throws {
        let gateway = FakeCollaborationGateway()
        gateway.cancelOwnershipTransferResult = .success(fakeOwnershipTransfer(gardenId: "garden-1", state: .cancelled))
        // `fetchGardenOwnershipTransferResult` is left at its default
        // "nothing pending" `404` — the same answer the real API gives once
        // a transfer is cancelled, which `reload()` re-fetches for real
        // rather than reading a locally-cleared cache.
        let model = makeModel(gateway: gateway, gardenId: "garden-1")

        await model.confirmCancelTransfer()

        #expect(model.outgoingTransfer == nil)
        #expect(gateway.cancelOwnershipTransferCalls == ["garden-1"])
    }

    @Test("The share link for an outgoing transfer names its own garden")
    func outgoingTransferShareURL() async throws {
        let gateway = FakeCollaborationGateway()
        gateway.fetchGardenOwnershipTransferResult = .success(fakeOwnershipTransfer(gardenId: "garden-42"))
        let model = makeModel(gateway: gateway, gardenId: "garden-42")
        await model.load()

        let link = try #require(model.outgoingTransferShareURL)
        #expect(link.scheme == "verdery")
        #expect(link.host == "ownership-transfer")
        #expect(URLComponents(url: link, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "gardenId" })?.value == "garden-42")
    }
}

/// Throws `Unimplemented` for every operation — used only to prove
/// `CollaboratorsViewModel.load()` maps a `listMembers` failure to a
/// localized message.
private final class ThrowingCollaborationGateway: CollaborationGateway, @unchecked Sendable {
    struct Unimplemented: Error {}

    func listMembers(gardenId: String) async throws -> [GardenMember] { throw Unimplemented() }
    func createInvitation(gardenId: String, intendedRole: CollaboratorRole, intendedEmail: String?, idempotencyKey: String) async throws -> CreatedGardenInvitation { throw Unimplemented() }
    func listInvitations(gardenId: String) async throws -> [GardenInvitation] { throw Unimplemented() }
    func revokeInvitation(gardenId: String, invitationId: String, idempotencyKey: String) async throws -> GardenInvitation { throw Unimplemented() }
    func acceptInvitation(token: String, idempotencyKey: String) async throws -> GardenMember { throw Unimplemented() }
    func changeMemberRole(gardenId: String, profileId: String, role: CollaboratorRole, idempotencyKey: String) async throws -> GardenMember { throw Unimplemented() }
    func removeMember(gardenId: String, profileId: String, idempotencyKey: String) async throws -> GardenMember { throw Unimplemented() }
    func promoteMember(gardenId: String, profileId: String, idempotencyKey: String) async throws -> GardenMember { throw Unimplemented() }
    func demoteOwner(gardenId: String, profileId: String, role: CollaboratorRole, idempotencyKey: String) async throws -> GardenMember { throw Unimplemented() }
    func transferOwnership(gardenId: String, toProfileId: String, resultingRole: CollaboratorRole, idempotencyKey: String) async throws -> GardenOwnershipTransfer { throw Unimplemented() }
    func cancelOwnershipTransfer(gardenId: String, idempotencyKey: String) async throws -> GardenOwnershipTransfer { throw Unimplemented() }
    func acceptOwnershipTransfer(gardenId: String, idempotencyKey: String) async throws -> GardenOwnershipTransfer { throw Unimplemented() }
    func declineOwnershipTransfer(gardenId: String, idempotencyKey: String) async throws -> GardenOwnershipTransfer { throw Unimplemented() }
    func fetchGardenOwnershipTransfer(gardenId: String) async throws -> GardenOwnershipTransfer { throw Unimplemented() }
    func fetchIncomingOwnershipTransfers() async throws -> [IncomingGardenOwnershipTransfer] { throw Unimplemented() }
}
