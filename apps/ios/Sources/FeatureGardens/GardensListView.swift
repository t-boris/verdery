import CoreDesignSystem
import SwiftUI

/// The garden picker: the app's front door.
///
/// Each garden is a card rather than a table row — a garden is a thing, not a
/// setting — carrying its lifecycle and the reader's role as chips, and its
/// unsynchronized state as a glyph. Creating one moved out of a permanently
/// visible form section into a sheet behind a toolbar `+`, so the list stays a
/// list and the empty state becomes the thing that offers the first garden
/// rather than a sentence noting there are none.
///
/// Selecting a garden no longer pushes a settings screen: it hands the id up
/// to `AppComposition`, which swaps the whole root for that garden's tab bar.
///
/// Source: architecture/ios-application-design.md, section "5.1 Presentation";
/// implementation-plan.md work package P2-IOS-01; work package P8-UX-01.
public struct GardensListView: View {
    @State private var model: GardensListViewModel
    @State private var isCreatePresented = false
    @FocusState private var isNameFieldFocused: Bool
    private let onOpen: (String, String) -> Void

    public init(model: GardensListViewModel, onOpen: @escaping (String, String) -> Void) {
        _model = State(wrappedValue: model)
        self.onOpen = onOpen
    }

    public var body: some View {
        content
            .navigationTitle(model.title)
            .screenBackground()
            .task { await model.load() }
            .refreshable { await model.load() }
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        isCreatePresented = true
                    } label: {
                        Label(model.createTitle, systemImage: "plus")
                    }
                    .accessibilityIdentifier("gardens.create.open")
                }
            }
            .sheet(isPresented: $isCreatePresented) { createSheet }
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .loading:
            LoadingStateView(model.loadingMessage)
                .accessibilityIdentifier("gardens.loading")

        case let .loaded(items) where items.isEmpty:
            EmptyStateView(
                symbol: "tree",
                title: model.title,
                message: model.emptyMessage,
                actionTitle: model.createTitle,
                action: { isCreatePresented = true }
            )
            .accessibilityIdentifier("gardens.empty")

        case let .loaded(items):
            ScrollView {
                LazyVStack(spacing: Metrics.space3) {
                    ForEach(items) { item in
                        Button {
                            onOpen(item.id, item.name)
                        } label: {
                            card(for: item)
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("gardens.row.\(item.id)")
                    }
                }
                .padding(Metrics.space4)
            }

        case let .failed(message):
            FailureStateView(
                message: message,
                retryTitle: model.retryTitle,
                retry: { Task { await model.load() } }
            )
            .accessibilityIdentifier("gardens.failure")
        }
    }

    private func card(for item: GardenSummary) -> some View {
        SurfaceCard {
            HStack(spacing: Metrics.space3) {
                // The medallion stands for the garden; the chip beside it
                // stands for the garden's state. Both drew the lifecycle
                // symbol until a screenshot showed the same glyph twice on
                // every row.
                IconMedallion(
                    symbol: "tree.fill",
                    label: item.name,
                    tone: GardenSymbols.lifecycleTone(item.lifecycleState)
                )

                VStack(alignment: .leading, spacing: Metrics.space2) {
                    Text(item.name)
                        .font(Typography.heading)
                        .foregroundStyle(Palette.text)
                        .lineLimit(2)

                    HStack(spacing: Metrics.space2) {
                        Chip(
                            symbol: GardenSymbols.lifecycle(item.lifecycleState),
                            label: item.lifecycleLabel,
                            tone: GardenSymbols.lifecycleTone(item.lifecycleState)
                        )
                        Chip(
                            symbol: GardenSymbols.role(item.callerRole),
                            label: item.roleLabel,
                            tone: .neutral
                        )
                        if let syncStatusLabel = item.syncStatusLabel {
                            StatusGlyph(
                                symbol: GardenSymbols.pendingSync,
                                label: syncStatusLabel,
                                tone: .warning
                            )
                            .accessibilityIdentifier("gardens.row.syncStatus")
                        }
                    }
                }

                Spacer(minLength: 0)

                Image(systemName: "chevron.right")
                    .font(Typography.detail)
                    .foregroundStyle(Palette.textMuted)
                    .accessibilityHidden(true)
            }
        }
    }

    /// Creating a garden is a short, focused act, so it gets a half-height
    /// sheet rather than a form section that is on screen forever. The field
    /// takes focus on appear and the keyboard's return key submits, so the
    /// whole path is: tap `+`, type, return.
    private var createSheet: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: Metrics.space4) {
                ComposerField(
                    symbol: "tree.fill",
                    accessibilityName: model.createNameLabel,
                    placeholder: model.createNameLabel,
                    commitLabel: model.createSubmitTitle,
                    text: $model.newGardenName,
                    commit: submitCreate
                )
                .accessibilityIdentifier("gardens.create.nameField")

                if let message = model.createErrorMessage {
                    InlineMessage(message)
                        .accessibilityIdentifier("gardens.create.failure")
                }

                Button(action: submitCreate) {
                    Label(model.createSubmitTitle, systemImage: "checkmark")
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(isSubmitDisabled)
                .accessibilityIdentifier("gardens.create.submit")

                Spacer()
            }
            .padding(Metrics.space4)
            .navigationTitle(model.createTitle)
            .inlineNavigationTitle()
            .screenBackground()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(model.cancelTitle) { isCreatePresented = false }
                }
            }
            .onAppear { isNameFieldFocused = true }
        }
        .presentationDetents([.medium])
    }

    /// Inline rather than after submitting: an empty name cannot succeed, so
    /// the control says so by being unavailable instead of accepting the tap
    /// and answering with an error.
    private var isSubmitDisabled: Bool {
        model.isCreating
            || model.newGardenName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func submitCreate() {
        guard !isSubmitDisabled else { return }

        Task {
            await model.submitNewGarden()
            if model.createErrorMessage == nil {
                Haptics.play(.success)
                isCreatePresented = false
            } else {
                Haptics.play(.failure)
            }
        }
    }
}
