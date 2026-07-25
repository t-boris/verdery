import SwiftUI

/// One Today item in full: the stored reason verbatim, the priority
/// breakdown (every stored factor as readable text — the factors alone
/// reproduce the rank), the structured evidence, and the five controls:
/// complete, postpone (with an optional user horizon), dismiss,
/// mark-irrelevant, and convert-to-task.
///
/// Shares the list's ``TodayViewModel`` — an action here refreshes the same
/// state the list renders, so a completed or converted item leaves both
/// screens' truth at once. After the item leaves the set this view stays
/// honest: the conversion confirmation (with its open-tasks link, the
/// phase's real outcome-history linkage) or the no-longer-in-Today notice.
public struct TodayItemDetailView: View {
    private let model: TodayViewModel
    private let itemId: String

    @State private var postponeHasDate = false
    @State private var postponeDate: Date = .now

    public init(model: TodayViewModel, itemId: String) {
        self.model = model
        self.itemId = itemId
    }

    private var item: TodayItemPresentation? {
        guard case let .loaded(items) = model.state else { return nil }
        return items.first { $0.id == itemId }
    }

    public var body: some View {
        List {
            if let item {
                itemSections(item)
            } else {
                outcomeSection
            }
        }
        .navigationTitle(model.title)
        .sheet(isPresented: isPostponeSheetPresented) { postponeSheet }
    }

    @ViewBuilder
    private func itemSections(_ item: TodayItemPresentation) -> some View {
        Section {
            Text(item.actionTitle).font(.headline)
            Text(item.targetLabel).foregroundStyle(.secondary)
            HStack {
                Text(item.urgencyLabel)
                Text("·")
                Text(item.careCategory)
                Text("·")
                Text(item.priorityScoreText)
            }
            .font(.footnote)
            .foregroundStyle(.secondary)
            if let windowText = item.windowText {
                Text(windowText).font(.footnote).foregroundStyle(.secondary)
            }
            Text(item.safetyTierLabel)
                .font(.footnote)
                .foregroundStyle(item.isElevatedRisk ? .orange : .secondary)
                .accessibilityIdentifier("today.detail.safetyTier")
        }

        Section(model.reasonTitle) {
            Text(item.explanation)
                .accessibilityIdentifier("today.detail.reason")
        }

        Section(model.priorityBreakdownTitle) {
            ForEach(Array(item.factorLines.enumerated()), id: \.offset) { entry in
                Text(entry.element).font(.footnote)
            }
        }

        Section(model.evidenceTitle) {
            ForEach(item.evidenceLines) { line in
                VStack(alignment: .leading, spacing: 2) {
                    Text(line.kindLabel).font(.footnote).bold()
                    Text(line.factText).font(.footnote).foregroundStyle(.secondary)
                }
                .accessibilityIdentifier("today.detail.evidence.\(line.id)")
            }
        }

        controlsSection(item)
    }

    @ViewBuilder
    private func controlsSection(_ item: TodayItemPresentation) -> some View {
        Section(model.controlsTitle) {
            Button(model.completeActionTitle) {
                Task { await model.complete(itemId: item.id) }
            }
            .accessibilityIdentifier("today.detail.complete")

            Button(model.postponeActionTitle) {
                postponeHasDate = false
                postponeDate = .now
                model.postponingItemId = item.id
            }
            .accessibilityIdentifier("today.detail.postpone")

            Button(model.convertActionTitle) {
                Task { await model.convert(itemId: item.id) }
            }
            .accessibilityIdentifier("today.detail.convert")

            Button(model.markIrrelevantActionTitle) {
                Task { await model.markIrrelevant(itemId: item.id) }
            }
            .accessibilityIdentifier("today.detail.markIrrelevant")

            Button(model.dismissActionTitle, role: .destructive) {
                Task { await model.dismiss(itemId: item.id) }
            }
            .accessibilityIdentifier("today.detail.dismiss")
        }
        .disabled(model.isPerformingAction)

        if model.irrelevantRecordedItemId == item.id {
            Section {
                Text(model.irrelevantRecordedMessage)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("today.detail.irrelevantRecorded")
            }
        }

        errorSection
    }

    /// What this screen shows once the item is no longer in the loaded set:
    /// the conversion confirmation with the open-tasks link, or the honest
    /// no-longer-in-Today notice for every other way it left.
    @ViewBuilder
    private var outcomeSection: some View {
        Section {
            if model.convertedItemId == itemId, let message = model.convertedMessage {
                Text(message)
                    .accessibilityIdentifier("today.detail.converted")
                NavigationLink(value: TodayTasksRoute(gardenId: model.gardenId)) {
                    Text(model.openTasksTitle)
                }
                .accessibilityIdentifier("today.detail.openTasks")
            } else {
                Text(model.goneMessage)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("today.detail.gone")
            }
        }

        errorSection
    }

    @ViewBuilder
    private var errorSection: some View {
        if let message = model.actionErrorMessage {
            Section {
                Text(message)
                    .foregroundStyle(.red)
                    .accessibilityIdentifier("today.detail.actionFailure")
            }
        }
    }

    private var isPostponeSheetPresented: Binding<Bool> {
        Binding(
            get: { model.postponingItemId == itemId },
            set: { isPresented in if !isPresented { model.postponingItemId = nil } }
        )
    }

    private var postponeSheet: some View {
        NavigationStack {
            Form {
                Toggle(model.postponeUntilToggleLabel, isOn: $postponeHasDate)
                    .accessibilityIdentifier("today.postpone.dateToggle")
                if postponeHasDate {
                    DatePicker(model.postponeUntilLabel, selection: $postponeDate)
                        .accessibilityIdentifier("today.postpone.datePicker")
                } else {
                    Text(model.postponeNoDateFootnote)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                if let message = model.actionErrorMessage {
                    Text(message).foregroundStyle(.red)
                }

                Button(model.postponeSubmitTitle) {
                    Task {
                        await model.submitPostpone(itemId: itemId, until: postponeHasDate ? postponeDate : nil)
                    }
                }
                .disabled(model.isPerformingAction)
                .accessibilityIdentifier("today.postpone.submit")

                Button(model.cancelTitle, role: .cancel) {
                    model.postponingItemId = nil
                }
            }
            .navigationTitle(model.postponeActionTitle)
        }
    }
}
