import SwiftUI

/// One shared confirmation dialog for every owner-administration action on
/// the Collaborators screen, driven by `CollaboratorsViewModel.pendingAction`.
///
/// A single dialog rather than one per row/action, because the roster is a
/// list: attaching a `confirmationDialog` to each row would mean as many
/// dialogs as members, all bound to the same underlying intent. `demote` and
/// `transferOwnership` each offer TWO action buttons (one per resulting
/// role) instead of a single generic confirmation, because both need the
/// owner to choose editor-or-viewer at the moment of confirming — see
/// `ConfirmableCollaborationAction`'s own doc comment.
extension View {
    func confirmationDialogs(for model: CollaboratorsViewModel) -> some View {
        modifier(CollaboratorsConfirmationDialogModifier(model: model))
    }
}

private struct CollaboratorsConfirmationDialogModifier: ViewModifier {
    let model: CollaboratorsViewModel

    func body(content: Content) -> some View {
        content.confirmationDialog(
            title,
            isPresented: isPresented,
            titleVisibility: .visible
        ) {
            actions
            Button(model.cancelTitle, role: .cancel) { model.cancelPendingAction() }
        } message: {
            if let message { Text(message) }
        }
    }

    private var isPresented: Binding<Bool> {
        Binding(
            get: { model.pendingAction != nil },
            set: { isPresented in if !isPresented { model.cancelPendingAction() } }
        )
    }

    private var title: String {
        switch model.pendingAction {
        case .revokeInvitation: model.revokeInvitationTitle
        case .changeRole: model.changeRoleActionTitle
        case .promote: model.promoteActionTitle
        case .demote: model.demoteActionTitle
        case .remove: model.removeActionTitle
        case .transferOwnership: model.ownershipTransferButtonTitle
        case .cancelTransfer: model.ownershipTransferCancelTitle
        case nil: ""
        }
    }

    private var message: String? {
        switch model.pendingAction {
        case .revokeInvitation: model.revokeInvitationConfirmMessage
        case let .changeRole(_, newRole): model.changeRoleConfirmMessage(newRole: newRole)
        case .promote: model.promoteConfirmMessage
        case .demote: model.demoteConfirmMessage
        case .remove: model.removeConfirmMessage
        case .transferOwnership: model.transferConfirmMessage
        case .cancelTransfer: model.ownershipTransferCancelConfirmMessage
        case nil: nil
        }
    }

    @ViewBuilder
    private var actions: some View {
        switch model.pendingAction {
        case let .revokeInvitation(invitationId):
            Button(model.revokeInvitationTitle, role: .destructive) {
                Task { await model.confirmRevokeInvitation(invitationId: invitationId) }
            }

        case let .changeRole(profileId, newRole):
            Button(model.roleLabel(for: newRole.gardenRole)) {
                Task { await model.confirmChangeRole(profileId: profileId, role: newRole) }
            }

        case let .promote(profileId):
            Button(model.promoteActionTitle) {
                Task { await model.confirmPromote(profileId: profileId) }
            }

        case let .demote(profileId):
            Button(model.roleLabel(for: .editor)) {
                Task { await model.confirmDemote(profileId: profileId, role: .editor) }
            }
            Button(model.roleLabel(for: .viewer)) {
                Task { await model.confirmDemote(profileId: profileId, role: .viewer) }
            }

        case let .remove(profileId):
            Button(model.removeActionTitle, role: .destructive) {
                Task { await model.confirmRemove(profileId: profileId) }
            }

        case let .transferOwnership(profileId):
            Button(model.roleLabel(for: .editor)) {
                Task { await model.confirmTransferOwnership(profileId: profileId, resultingRole: .editor) }
            }
            Button(model.roleLabel(for: .viewer)) {
                Task { await model.confirmTransferOwnership(profileId: profileId, resultingRole: .viewer) }
            }

        case .cancelTransfer:
            Button(model.ownershipTransferCancelTitle, role: .destructive) {
                Task { await model.confirmCancelTransfer() }
            }

        case nil:
            EmptyView()
        }
    }
}
