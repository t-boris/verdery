import CoreDesignSystem
import SwiftUI

/// A single garden's settings.
///
/// What this screen is no longer: the app's front door. It used to be a `Form`
/// whose middle section held `NavigationLink`s to Today, the map, the plan
/// upload, plants, observations, tasks, and sync conflicts — the whole product,
/// filed under settings. Those five daily surfaces are now tabs
/// (`AppComposition.GardenTabView`), and what stays here is what genuinely
/// configures a garden: its name, its lifecycle, the property plan behind its
/// map, the conflicts synchronization is waiting on, and the service's status.
///
/// Both destructive actions now confirm before running, using the catalogue's
/// `gardens.archive.confirm` and `gardens.requestDeletion.confirm` sentences —
/// written for exactly this and never shown to anyone until now. Neither is
/// reversible from this screen, and a form row that archived a garden on one
/// mis-tap is the kind of thing this pass exists to remove.
///
/// Source: implementation-plan.md work packages P2-IOS-01, P2-SEC-01;
/// work package P8-UX-01.
public struct GardenSettingsView: View {
    @State private var model: GardenSettingsViewModel
    @State private var isArchiveConfirmationPresented = false
    @State private var isDeletionConfirmationPresented = false
    @FocusState private var isNameFieldFocused: Bool
    @Environment(\.dismiss) private var dismiss

    private let onSwitchGarden: (() -> Void)?

    public init(model: GardenSettingsViewModel, onSwitchGarden: (() -> Void)? = nil) {
        _model = State(wrappedValue: model)
        self.onSwitchGarden = onSwitchGarden
    }

    public var body: some View {
        content
            .navigationTitle(model.title)
            .inlineNavigationTitle()
            .screenBackground()
            .task { await model.load() }
            .onChange(of: model.didRequestDeletion) { _, requested in
                if requested { dismiss() }
            }
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .loading:
            LoadingStateView(model.title)
                .accessibilityIdentifier("gardens.settings.loading")

        case let .loaded(summary):
            ScrollView {
                VStack(alignment: .leading, spacing: Metrics.space5) {
                    identityCard(summary)
                    configurationSection(summary)

                    if summary.isOwner {
                        renameSection(summary)
                        manageSection(summary)
                    }

                    switchGardenButton

                    if let message = model.actionErrorMessage {
                        InlineMessage(message)
                            .accessibilityIdentifier("gardens.settings.actionFailure")
                    }
                }
                .padding(Metrics.space4)
            }

        case let .failed(message):
            if model.didLoseAccess {
                // `onSwitchGarden` unwinds all the way to the gardens list
                // (`RootView.signedInBody`'s `{ self.selectedGarden = nil }`),
                // not merely this sheet — the whole tab shell underneath it
                // is for a garden this profile no longer has access to, so
                // dismissing only the settings sheet would leave that
                // broken shell on screen. Falls back to `dismiss()` (closing
                // only this sheet) on the rare construction that supplies no
                // callback at all, rather than presenting no action.
                FailureStateView(message: message, retryTitle: model.backToGardensTitle) {
                    if let onSwitchGarden {
                        onSwitchGarden()
                    } else {
                        dismiss()
                    }
                }
                .accessibilityIdentifier("gardens.settings.revokedAccess")
            } else {
                FailureStateView(message: message)
                    .accessibilityIdentifier("gardens.settings.failure")
            }
        }
    }

    /// The garden itself, at a glance: name in the display face, state and
    /// role as chips, pending synchronization as a chip of its own.
    private func identityCard(_ summary: GardenSettingsSummary) -> some View {
        SurfaceCard {
            VStack(alignment: .leading, spacing: Metrics.space3) {
                HStack(spacing: Metrics.space3) {
                    IconMedallion(
                        symbol: GardenSymbols.lifecycle(summary.lifecycleState),
                        label: summary.lifecycleLabel,
                        tone: GardenSymbols.lifecycleTone(summary.lifecycleState),
                        isLarge: true
                    )
                    Text(summary.name)
                        .font(Typography.title)
                        .foregroundStyle(Palette.text)
                }

                HStack(spacing: Metrics.space2) {
                    Chip(
                        symbol: GardenSymbols.lifecycle(summary.lifecycleState),
                        label: summary.lifecycleLabel,
                        tone: GardenSymbols.lifecycleTone(summary.lifecycleState)
                    )
                    Chip(
                        symbol: GardenSymbols.role(summary.callerRole),
                        label: summary.roleLabel,
                        tone: .info
                    )
                    if let syncStatusLabel = summary.syncStatusLabel {
                        Chip(
                            symbol: GardenSymbols.pendingSync,
                            label: syncStatusLabel,
                            tone: .warning
                        )
                        .accessibilityIdentifier("gardens.settings.syncStatus")
                    }
                }
            }
        }
    }

    /// The destinations that are configuration rather than daily work.
    /// Collaborators is the one card every role sees — the member roster
    /// itself is not owner-only (`garden-capability-matrix.md`, row H2) —
    /// while the other four stay visible regardless of role too, matching
    /// this section's existing posture of hiding nothing, only the
    /// owner-only mutating controls further down (`renameSection`,
    /// `manageSection`).
    ///
    /// Context quality (P9D-UX-01) joins this same section as a fifth card,
    /// resolving a genuine ambiguity in how this package's own dispatch
    /// worded the requirement ("a new section function... reached via a
    /// `navigationCard`... the same way `GardenCollaboratorsRoute`/
    /// `GardenPlanUploadRoute` already are"): both of those routes are
    /// themselves already just `navigationCard` entries INSIDE this one
    /// function, not separate top-level sections of their own — there is no
    /// existing precedent for a section that holds exactly one card. Adding
    /// a sixth-card-shaped standalone section here would invent a new
    /// pattern this file does not otherwise have; a fifth card in the
    /// existing, already-established "configuration destinations" list is
    /// the more conservative reading, and literally what "the same way...
    /// already are" describes.
    private func configurationSection(_ summary: GardenSettingsSummary) -> some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            SectionEyebrow(symbol: "slider.horizontal.3", title: model.title)

            navigationCard(
                value: GardenCollaboratorsRoute(gardenId: model.gardenId, isOwner: summary.isOwner),
                symbol: CollaborationSymbols.member,
                title: model.openCollaboratorsTitle,
                identifier: "gardens.settings.openCollaborators"
            )
            navigationCard(
                value: GardenContextQualityRoute(gardenId: model.gardenId, callerRole: summary.callerRole),
                symbol: "sun.max",
                title: model.openContextQualityTitle,
                identifier: "gardens.settings.openContextQuality"
            )
            navigationCard(
                value: GardenPlanUploadRoute(gardenId: model.gardenId),
                symbol: "doc.viewfinder",
                title: model.openPlanUploadTitle,
                identifier: "gardens.settings.openPlanUpload"
            )
            navigationCard(
                value: GardenSyncConflictsRoute(gardenId: model.gardenId),
                symbol: "arrow.triangle.branch",
                title: model.openSyncConflictsTitle,
                identifier: "gardens.settings.openSyncConflicts"
            )
            navigationCard(
                value: GardenServiceHealthRoute(),
                symbol: "waveform.path.ecg",
                title: model.serviceHealthTitle,
                identifier: "gardens.settings.openServiceHealth"
            )
        }
    }

    private func navigationCard(
        value: some Hashable,
        symbol: String,
        title: String,
        identifier: String
    ) -> some View {
        NavigationLink(value: value) {
            SurfaceCard {
                HStack(spacing: Metrics.space3) {
                    IconMedallion(symbol: symbol, label: title, tone: .accent)
                    Text(title)
                        .font(Typography.body)
                        .foregroundStyle(Palette.text)
                        .multilineTextAlignment(.leading)
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right")
                        .font(Typography.detail)
                        .foregroundStyle(Palette.textMuted)
                        .accessibilityHidden(true)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(identifier)
    }

    private func renameSection(_ summary: GardenSettingsSummary) -> some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            SectionEyebrow(symbol: "textformat", title: model.renameFieldLabel)

            SurfaceCard {
                VStack(alignment: .leading, spacing: Metrics.space3) {
                    TextField(model.renameFieldLabel, text: $model.editedName)
                        .textFieldStyle(.roundedBorder)
                        .focused($isNameFieldFocused)
                        .submitLabel(.done)
                        .onSubmit(submitRename)
                        .accessibilityIdentifier("gardens.settings.nameField")

                    Button(action: submitRename) {
                        Label(model.renameSubmitTitle, systemImage: "checkmark")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(model.isSubmitting || !summary.isActive)
                    .accessibilityIdentifier("gardens.settings.rename")
                }
            }
        }
    }

    private func manageSection(_ summary: GardenSettingsSummary) -> some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            SectionEyebrow(symbol: "exclamationmark.triangle", title: model.manageTitle)

            if summary.isActive {
                Button {
                    isArchiveConfirmationPresented = true
                } label: {
                    Label(model.archiveTitle, systemImage: "archivebox")
                }
                .buttonStyle(SecondaryButtonStyle())
                .disabled(model.isSubmitting)
                .accessibilityIdentifier("gardens.settings.archive")
                .confirmationDialog(
                    model.archiveConfirmMessage,
                    isPresented: $isArchiveConfirmationPresented,
                    titleVisibility: .visible
                ) {
                    Button(model.archiveTitle) {
                        Task {
                            await model.archive()
                            Haptics.play(.warning)
                        }
                    }
                    Button(model.cancelTitle, role: .cancel) {}
                }
            }

            Button {
                isDeletionConfirmationPresented = true
            } label: {
                Label(model.requestDeletionTitle, systemImage: "trash")
            }
            .buttonStyle(SecondaryButtonStyle())
            .disabled(model.isSubmitting)
            .accessibilityIdentifier("gardens.settings.requestDeletion")
            .confirmationDialog(
                model.requestDeletionConfirmMessage,
                isPresented: $isDeletionConfirmationPresented,
                titleVisibility: .visible
            ) {
                Button(model.requestDeletionTitle, role: .destructive) {
                    Task {
                        await model.requestDeletion()
                        Haptics.play(.warning)
                    }
                }
                Button(model.cancelTitle, role: .cancel) {}
            }
        }
    }

    @ViewBuilder
    private var switchGardenButton: some View {
        if let onSwitchGarden {
            Button(action: onSwitchGarden) {
                Label(model.switchGardenTitle, systemImage: "arrow.left.arrow.right")
            }
            .buttonStyle(SecondaryButtonStyle())
            .accessibilityIdentifier("gardens.settings.switchGarden")
        }
    }

    private func submitRename() {
        Task {
            await model.submitRename()
            Haptics.play(model.actionErrorMessage == nil ? .success : .failure)
        }
    }
}
