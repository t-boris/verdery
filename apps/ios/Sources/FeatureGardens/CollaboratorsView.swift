import CoreDesignSystem
import CoreDomain
import SwiftUI

/// The Collaborators screen: member roster (every role), invitations and
/// role administration (owner-only), and ownership transfer (owner-only).
///
/// Built to the same bar `ProfileView`/`GardenSettingsView` already set:
/// icon-forward rows, real design-system tokens, and a confirmation dialog
/// before every owner-administration action — these are, per the task's own
/// framing, "irreversible-in-the-moment actions on someone else's access."
///
/// Source: implementation-plan.md work package P9A-IOS-01.
public struct CollaboratorsView: View {
    @State private var model: CollaboratorsViewModel
    @State private var isInviteSheetPresented = false

    public init(model: CollaboratorsViewModel) {
        _model = State(wrappedValue: model)
    }

    public var body: some View {
        content
            .navigationTitle(model.title)
            .inlineNavigationTitle()
            .screenBackground()
            .task { await model.load() }
            .sheet(isPresented: $isInviteSheetPresented) {
                InviteCollaboratorSheetView(model: model) { isInviteSheetPresented = false }
            }
            .confirmationDialogs(for: model)
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .loading:
            LoadingStateView(model.title)
                .accessibilityIdentifier("collaborators.loading")

        case let .loaded(summary):
            ScrollView {
                VStack(alignment: .leading, spacing: Metrics.space5) {
                    membersSection(summary)
                    if summary.isOwner {
                        ownershipTransferSection
                        pendingInvitationsSection(summary)
                    }

                    if let message = model.actionErrorMessage {
                        InlineMessage(message)
                            .accessibilityIdentifier("collaborators.actionFailure")
                    }
                }
                .padding(Metrics.space4)
            }

        case let .failed(message):
            FailureStateView(message: message, retryTitle: model.retryTitle) {
                Task { await model.load() }
            }
            .accessibilityIdentifier("collaborators.failure")
        }
    }

    private func membersSection(_ summary: CollaboratorsSummary) -> some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            HStack {
                SectionEyebrow(symbol: CollaborationSymbols.member, title: model.membersSectionTitle)
                Spacer(minLength: Metrics.space2)
                if summary.isOwner {
                    Button {
                        isInviteSheetPresented = true
                    } label: {
                        Label(model.inviteButtonTitle, systemImage: CollaborationSymbols.invite)
                    }
                    .font(FieldConsoleType.detail.font)
                    .accessibilityIdentifier("collaborators.invite.open")
                }
            }

            ForEach(summary.members) { member in
                memberRow(member, isOwnerScreen: summary.isOwner)
            }
        }
    }

    private func memberRow(_ member: CollaboratorRow, isOwnerScreen: Bool) -> some View {
        SurfaceCard {
            HStack(spacing: Metrics.space3) {
                IconMedallion(symbol: GardenSymbols.role(member.role), label: member.roleLabel)
                VStack(alignment: .leading, spacing: Metrics.space1) {
                    Text(member.nameLabel)
                        .font(FieldConsoleType.body.font)
                        .foregroundStyle(Palette.text)
                    Chip(symbol: GardenSymbols.role(member.role), label: member.roleLabel, tone: .neutral)
                }
                Spacer(minLength: 0)

                if isOwnerScreen {
                    Menu {
                        memberActions(member)
                    } label: {
                        Image(systemName: "ellipsis.circle")
                            .font(FieldConsoleType.body.font)
                            .foregroundStyle(Palette.textMuted)
                    }
                    .accessibilityIdentifier("collaborators.member.\(member.id).actions")
                }
            }
        }
    }

    @ViewBuilder
    private func memberActions(_ member: CollaboratorRow) -> some View {
        if member.role == .owner {
            Button(model.demoteActionTitle) {
                model.requestConfirmation(.demote(profileId: member.id))
            }
        } else {
            let otherRole: CollaboratorRole = member.role == .editor ? .viewer : .editor
            Button(model.changeRoleActionTitle) {
                model.requestConfirmation(.changeRole(profileId: member.id, newRole: otherRole))
            }
            Button(model.promoteActionTitle) {
                model.requestConfirmation(.promote(profileId: member.id))
            }
            if model.outgoingTransfer == nil {
                Button(model.ownershipTransferButtonTitle) {
                    model.requestConfirmation(.transferOwnership(profileId: member.id))
                }
            }
        }

        Button(model.removeActionTitle, role: .destructive) {
            model.requestConfirmation(.remove(profileId: member.id))
        }
    }

    @ViewBuilder
    private var ownershipTransferSection: some View {
        if let transfer = model.outgoingTransfer {
            VStack(alignment: .leading, spacing: Metrics.space2) {
                SectionEyebrow(symbol: CollaborationSymbols.ownershipTransfer, title: model.ownershipTransferTitle)

                SurfaceCard(tone: .warning) {
                    VStack(alignment: .leading, spacing: Metrics.space3) {
                        Chip(symbol: CollaborationSymbols.ownershipTransfer, label: model.ownershipTransferPendingLabel, tone: .warning)

                        if let link = model.outgoingTransferShareURL {
                            ShareLink(item: link, subject: Text(model.ownershipTransferTitle), message: Text(model.outgoingTransferShareMessage(link: link))) {
                                Label(model.ownershipTransferShareTitle, systemImage: CollaborationSymbols.share)
                            }
                            .buttonStyle(SecondaryButtonStyle())
                            .accessibilityIdentifier("collaborators.transfer.share")
                        }

                        Button(model.ownershipTransferCancelTitle, role: .destructive) {
                            model.requestConfirmation(.cancelTransfer)
                        }
                        .buttonStyle(SecondaryButtonStyle())
                        .accessibilityIdentifier("collaborators.transfer.cancel")
                    }
                }
                .accessibilityIdentifier("collaborators.transfer.pending")
            }
            .disabled(model.isSubmittingAction)
            .id(transfer.id)
        }
    }

    private func pendingInvitationsSection(_ summary: CollaboratorsSummary) -> some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            SectionEyebrow(symbol: CollaborationSymbols.pendingInvitation, title: model.pendingInvitationsSectionTitle)

            if summary.invitations.isEmpty {
                SurfaceCard {
                    Text(model.pendingInvitationsEmptyMessage)
                        .font(FieldConsoleType.secondary.font)
                        .foregroundStyle(Palette.textMuted)
                }
            } else {
                ForEach(summary.invitations) { invitation in
                    invitationRow(invitation)
                }
            }
        }
    }

    private func invitationRow(_ invitation: PendingInvitationRow) -> some View {
        SurfaceCard {
            HStack(spacing: Metrics.space3) {
                IconMedallion(
                    symbol: CollaborationSymbols.invitationState(invitation.state),
                    label: invitation.stateLabel,
                    tone: CollaborationSymbols.invitationStateTone(invitation.state)
                )
                VStack(alignment: .leading, spacing: Metrics.space1) {
                    Text(invitation.emailLabel)
                        .font(FieldConsoleType.body.font)
                        .foregroundStyle(Palette.text)
                    HStack(spacing: Metrics.space2) {
                        Chip(symbol: GardenSymbols.role(invitation.role.gardenRole), label: invitation.roleLabel, tone: .neutral)
                        Chip(
                            symbol: CollaborationSymbols.invitationState(invitation.state),
                            label: invitation.stateLabel,
                            tone: CollaborationSymbols.invitationStateTone(invitation.state)
                        )
                    }
                }
                Spacer(minLength: 0)

                if invitation.state == .pending {
                    Button(model.revokeInvitationTitle) {
                        model.requestConfirmation(.revokeInvitation(invitationId: invitation.id))
                    }
                    .font(FieldConsoleType.detail.font)
                    .foregroundStyle(Palette.negative)
                    .accessibilityIdentifier("collaborators.invitation.\(invitation.id).revoke")
                }
            }
        }
    }
}
