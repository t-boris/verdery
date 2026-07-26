import CoreDomain
import CoreNetworking

/// The confirmed owner-administration actions for `CollaboratorsViewModel` —
/// split out purely to keep `CollaboratorsViewModel.swift` well under this
/// repository's 600-line rule, the same `TasksListViewModelActions.swift`
/// precedent.
///
/// Every method here runs only after the view's own `confirmationDialog` has
/// confirmed the action — `pendingAction` is always cleared on entry, so a
/// second, stale confirmation can never replay.
extension CollaboratorsViewModel {
    public func confirmRevokeInvitation(invitationId: String) async {
        pendingAction = nil
        await perform {
            _ = try await self.revokeInvitation(gardenId: self.gardenId, invitationId: invitationId)
        }
    }

    public func confirmChangeRole(profileId: String, role: CollaboratorRole) async {
        pendingAction = nil
        await perform {
            _ = try await self.changeMemberRole(gardenId: self.gardenId, profileId: profileId, role: role)
        }
    }

    public func confirmPromote(profileId: String) async {
        pendingAction = nil
        await perform {
            _ = try await self.promoteMember(gardenId: self.gardenId, profileId: profileId)
        }
    }

    public func confirmDemote(profileId: String, role: CollaboratorRole) async {
        pendingAction = nil
        await perform {
            _ = try await self.demoteOwner(gardenId: self.gardenId, profileId: profileId, role: role)
        }
    }

    public func confirmRemove(profileId: String) async {
        pendingAction = nil
        await perform {
            _ = try await self.removeMember(gardenId: self.gardenId, profileId: profileId)
        }
    }

    public func confirmTransferOwnership(profileId: String, resultingRole: CollaboratorRole) async {
        pendingAction = nil
        await perform {
            _ = try await self.requestTransfer(
                gardenId: self.gardenId,
                toProfileId: profileId,
                resultingRole: resultingRole
            )
        }
    }

    public func confirmCancelTransfer() async {
        pendingAction = nil
        await perform {
            _ = try await self.cancelOwnershipTransfer(gardenId: self.gardenId)
        }
    }

    /// Runs one admin action: tracks submission state, refreshes the roster
    /// afterward on success (a role/ownership change is visible immediately,
    /// not only on the screen's next independent `load()`), and reports a
    /// localized failure otherwise.
    private func perform(_ action: () async throws -> Void) async {
        isSubmittingAction = true
        actionErrorMessage = nil
        defer { isSubmittingAction = false }

        do {
            try await action()
            await reload()
        } catch let error as APIGatewayError {
            actionErrorMessage = CollaborationErrorMessage.generic(for: error, strings: strings)
        } catch {
            actionErrorMessage = strings(.serverUnexpected)
        }
    }
}
