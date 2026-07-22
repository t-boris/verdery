import SwiftUI

/// A single garden's settings: rename, archive, and request deletion,
/// present only for the owner.
///
/// Source: implementation-plan.md work packages P2-IOS-01, P2-SEC-01.
public struct GardenSettingsView: View {
    @State private var model: GardenSettingsViewModel
    @Environment(\.dismiss) private var dismiss

    public init(model: GardenSettingsViewModel) {
        _model = State(wrappedValue: model)
    }

    public var body: some View {
        content
            .navigationTitle(model.title)
            .task { await model.load() }
            .onChange(of: model.didRequestDeletion) { _, requested in
                if requested { dismiss() }
            }
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .loading:
            ProgressView()
                .accessibilityIdentifier("gardens.settings.loading")

        case let .loaded(summary):
            Form {
                Section {
                    Text("\(summary.lifecycleLabel) · \(summary.roleLabel)")
                        .foregroundStyle(.secondary)
                }

                // Available to every role, not only the owner — unlike
                // rename/archive/delete below, viewing and editing the map is
                // not an owner-only action, and the map's own commands
                // re-enforce role restrictions server-side regardless of what
                // this screen shows.
                Section {
                    NavigationLink(value: GardenMapEditorRoute(gardenId: model.gardenId)) {
                        Text(model.openMapEditorTitle)
                    }
                    .accessibilityIdentifier("gardens.settings.openMapEditor")
                }

                if summary.isOwner {
                    Section(model.renameFieldLabel) {
                        TextField(model.renameFieldLabel, text: $model.editedName)
                            .accessibilityIdentifier("gardens.settings.nameField")

                        Button(model.renameSubmitTitle) {
                            Task { await model.submitRename() }
                        }
                        .disabled(model.isSubmitting || !summary.isActive)
                        .accessibilityIdentifier("gardens.settings.rename")
                    }

                    if summary.isActive {
                        Section(model.archiveTitle) {
                            Button(model.archiveTitle, role: .destructive) {
                                Task { await model.archive() }
                            }
                            .disabled(model.isSubmitting)
                            .accessibilityIdentifier("gardens.settings.archive")
                        }
                    }

                    Section {
                        Button(model.requestDeletionTitle, role: .destructive) {
                            Task { await model.requestDeletion() }
                        }
                        .disabled(model.isSubmitting)
                        .accessibilityIdentifier("gardens.settings.requestDeletion")
                    }
                }

                if let message = model.actionErrorMessage {
                    Section {
                        Text(message).foregroundStyle(.red)
                    }
                }
            }

        case let .failed(message):
            Text(message)
                .accessibilityIdentifier("gardens.settings.failure")
        }
    }
}
