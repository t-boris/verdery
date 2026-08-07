import CoreDesignSystem
import CoreDomain
import SwiftUI

/// The invite-a-collaborator sheet: role picker, optional email, and —
/// once created — the one-time raw token as a shareable link.
///
/// Extracted from `CollaboratorsView` the same way `TaskCreateSheetView` is
/// extracted from `TasksListView`: a self-contained sheet is easier to read
/// than a permanently-nested form section, and this one has two genuinely
/// different states (composing the invitation, and disposing of a token that
/// can never be shown again).
struct InviteCollaboratorSheetView: View {
    @Bindable var model: CollaboratorsViewModel
    let onFinish: () -> Void

    @FocusState private var isEmailFieldFocused: Bool

    var body: some View {
        NavigationStack {
            Group {
                if let invitation = model.createdInvitation {
                    tokenView(invitation)
                } else {
                    formView
                }
            }
            .navigationTitle(model.inviteTitle)
            .inlineNavigationTitle()
            .screenBackground()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(model.cancelTitle) { onFinish() }
                }
            }
        }
    }

    private var formView: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Metrics.space5) {
                VStack(alignment: .leading, spacing: Metrics.space2) {
                    SectionEyebrow(symbol: "person.text.rectangle", title: model.inviteRoleLabel)
                    HStack(spacing: Metrics.space2) {
                        ForEach(CollaboratorRole.allCases, id: \.self) { role in
                            roleChip(role)
                        }
                        Spacer(minLength: 0)
                    }
                    .accessibilityIdentifier("collaborators.invite.rolePicker")
                }

                VStack(alignment: .leading, spacing: Metrics.space2) {
                    SectionEyebrow(symbol: "envelope", title: model.inviteEmailLabel)
                    SurfaceCard {
                        VStack(alignment: .leading, spacing: Metrics.space2) {
                            // An email address is the one field here that
                            // genuinely wants the system's own keyboard and
                            // autofill, so the composer carries them through
                            // rather than replacing them.
                            ComposerField(
                                symbol: "envelope",
                                accessibilityName: model.inviteEmailLabel,
                                placeholder: model.inviteEmailLabel,
                                commitLabel: model.inviteSubmitTitle,
                                text: $model.inviteEmail,
                                commit: { Task { await model.submitInvite() } }
                            )
                            .accessibilityIdentifier("collaborators.invite.emailField")
                            InlineMessage(model.inviteEmailHint, tone: .neutral)
                        }
                    }
                }

                if let message = model.inviteErrorMessage {
                    InlineMessage(message)
                        .accessibilityIdentifier("collaborators.invite.failure")
                }

                Button {
                    Task { await model.submitInvite() }
                } label: {
                    Label(model.inviteSubmitTitle, systemImage: "checkmark")
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(model.isSubmittingInvite)
                .accessibilityIdentifier("collaborators.invite.submit")
            }
            .padding(Metrics.space4)
        }
    }

    private func roleChip(_ role: CollaboratorRole) -> some View {
        Button {
            model.inviteRole = role
            Haptics.play(.selection)
        } label: {
            Chip(
                symbol: GardenSymbols.role(role.gardenRole),
                label: model.roleLabel(for: role.gardenRole),
                tone: .neutral
            )
            .overlay(
                Capsule(style: .continuous)
                    .strokeBorder(model.inviteRole == role ? Palette.interaction : Color.clear, lineWidth: Metrics.hairline)
            )
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(model.inviteRole == role ? [.isSelected] : [])
    }

    private func tokenView(_ invitation: CreatedGardenInvitation) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Metrics.space5) {
                SurfaceCard(tone: .warning) {
                    VStack(alignment: .leading, spacing: Metrics.space3) {
                        Text(model.inviteTokenTitle)
                            .font(Typography.heading)
                            .foregroundStyle(Palette.text)
                        InlineMessage(model.inviteTokenWarning, tone: .warning)

                        if let link = model.createdInvitationShareURL {
                            ShareLink(
                                item: link,
                                subject: Text(model.inviteTokenTitle),
                                message: Text(model.createdInvitationShareMessage(link: link))
                            ) {
                                Label(model.inviteShareTitle, systemImage: CollaborationSymbols.share)
                            }
                            .buttonStyle(PrimaryButtonStyle())
                            .accessibilityIdentifier("collaborators.invite.share")
                        }
                    }
                }
                .accessibilityIdentifier("collaborators.invite.token")

                Button(model.inviteDoneTitle) {
                    Task {
                        await model.dismissCreatedInvitation()
                        onFinish()
                    }
                }
                .buttonStyle(SecondaryButtonStyle())
                .accessibilityIdentifier("collaborators.invite.done")
            }
            .padding(Metrics.space4)
        }
    }
}
