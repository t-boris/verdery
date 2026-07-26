import CoreLocalization
import FeatureGardens
import Foundation

/// Factories for the Collaborators screen, the accept-invitation deep-link
/// screen, and the ownership-transfer-recipient review sheet (P9A-IOS-01) —
/// split from `AppCompositionRoot.swift` the same way
/// `AppCompositionRoot+LocalStores.swift`/`AccountEntryPoint.swift` already
/// are, purely to keep that file under this repository's 600-line rule.
extension AppCompositionRoot {
    /// `isOwner` is threaded through from `GardenCollaboratorsRoute` — see
    /// that type's own doc comment for why the caller's role is already known
    /// rather than re-derived here.
    public func makeCollaboratorsViewModel(gardenId: String, isOwner: Bool) -> CollaboratorsViewModel {
        CollaboratorsViewModel(
            gardenId: gardenId,
            isOwner: isOwner,
            listMembers: ListGardenMembers(gateway: collaborationGateway),
            createInvitation: CreateGardenInvitation(gateway: collaborationGateway),
            listInvitations: ListGardenInvitations(gateway: collaborationGateway),
            revokeInvitation: RevokeGardenInvitation(gateway: collaborationGateway),
            changeMemberRole: ChangeGardenMemberRole(gateway: collaborationGateway),
            removeMember: RemoveGardenMember(gateway: collaborationGateway),
            promoteMember: PromoteGardenMember(gateway: collaborationGateway),
            demoteOwner: DemoteGardenOwner(gateway: collaborationGateway),
            requestTransfer: RequestGardenOwnershipTransfer(gateway: collaborationGateway),
            cancelOwnershipTransfer: CancelGardenOwnershipTransfer(gateway: collaborationGateway),
            fetchOwnershipTransfer: FetchGardenOwnershipTransfer(gateway: collaborationGateway),
            strings: strings
        )
    }

    /// The accept-invitation screen `RootView` presents while
    /// `collaborationSessionState.pendingInvitationToken` is set — the
    /// landing page a `verdery://invite?token=` deep link opens into.
    public func makeAcceptInvitationViewModel(token: String) -> AcceptInvitationViewModel {
        AcceptInvitationViewModel(
            token: token,
            acceptInvitation: AcceptGardenInvitation(gateway: collaborationGateway),
            getGarden: GetGarden(gateway: gardenGateway, localStore: localGardenStore()),
            strings: strings
        )
    }

    /// The ownership-transfer-recipient review sheet
    /// `FeatureGardens.IncomingOwnershipTransferBanner` opens.
    public func makeIncomingOwnershipTransferReviewViewModel(
        gardenId: String,
        gardenName: String
    ) -> IncomingOwnershipTransferReviewViewModel {
        IncomingOwnershipTransferReviewViewModel(
            gardenId: gardenId,
            gardenName: gardenName,
            acceptTransfer: AcceptGardenOwnershipTransfer(gateway: collaborationGateway),
            declineTransfer: DeclineGardenOwnershipTransfer(gateway: collaborationGateway),
            sessionState: collaborationSessionState,
            strings: strings
        )
    }

    /// Polls `listIncomingOwnershipTransfers` (P9A-OWNER-02) and refreshes
    /// `collaborationSessionState.incomingTransfers` from the result — the
    /// real discovery path `IncomingOwnershipTransferBanner` reads, alongside
    /// the deep-link fast path. Called from two lifecycle triggers: `RootView`
    /// on every app-foreground transition (the same trigger
    /// `triggerSyncOnForeground` already uses for synchronization — see
    /// `architecture/ios-application-design.md` section "8. Synchronization
    /// Integration"), and `GardenTabView` once when a garden's own shell
    /// first appears, so opening a garden reflects a pending offer
    /// immediately rather than waiting for the next foregrounding.
    ///
    /// Fire-and-forget on failure, the same posture `RootView
    /// .triggerSyncOnForeground` already takes for its own foreground
    /// trigger: neither caller has a retry affordance of its own, and the
    /// next trigger resolves a failed attempt by simply trying again.
    public func refreshIncomingOwnershipTransfers() async {
        do {
            let transfers = try await FetchIncomingGardenOwnershipTransfers(gateway: collaborationGateway)()
            collaborationSessionState.setIncomingTransfers(transfers)
        } catch {
            // Best-effort: the banner keeps showing whatever the last
            // successful poll found (or nothing), until the next trigger.
        }
    }
}
