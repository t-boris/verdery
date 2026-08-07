import CoreDesignSystem
import CoreDomain
import SwiftUI

/// The create-a-task sheet.
///
/// It now speaks the same vocabulary as `TaskEditSheetView`, which is the point
/// — the two sheets describe the same record, and a person who has used one
/// should recognise the other. What that replaced, control by control:
///
/// - The title and notes were bordered text fields. A title is a composer line
///   with its own commit; a note is content on paper, and a box drawn around
///   prose makes a screen look like a form for no gain.
/// - **The target was a raw UUID typed by hand** — one field for a garden area
///   and another for a plant — and the sheet's own hint admitted it. Nobody
///   knows a UUID, so in practice the target was unusable. It is now a list of
///   names the garden already has.
/// - The due date was a toggle gating a wheel. Presence of an optional value is
///   not a boolean, and a wheel is the slowest way to say "tomorrow".
/// - The time window was a second toggle gating two more wheels, for what is
///   one span with two ends.
///
/// The submit control is disabled until the title is non-empty, rather than
/// accepting the tap and answering with an error afterwards.
struct TaskCreateSheetView: View {
    @Bindable var model: TasksListViewModel
    let onFinish: (Bool) -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Metrics.space4) {
                    ComposerField(
                        symbol: "checklist",
                        accessibilityName: model.titleLabel,
                        placeholder: model.titleLabel,
                        commitLabel: model.createSubmitTitle,
                        text: $model.createTitle,
                        isBusy: model.isSubmittingCreate,
                        commit: submit
                    )
                    .accessibilityIdentifier("tasks.create.titleField")

                    NoteCanvas(
                        accessibilityName: model.notesLabel,
                        placeholder: model.notesLabel,
                        text: $model.createNotes
                    )
                    .accessibilityIdentifier("tasks.create.notesField")

                    targetSection
                    urgencySection
                    dueDateSection
                    timeWindowSection

                    if let message = model.createErrorMessage {
                        InlineMessage(message)
                            .accessibilityIdentifier("tasks.create.failure")
                    }

                    Button(action: submit) {
                        Label(model.createSubmitTitle, systemImage: "checkmark")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(isSubmitDisabled)
                    .accessibilityIdentifier("tasks.create.submit")
                }
                .padding(Metrics.space4)
            }
            .navigationTitle(model.newTaskTitle)
            .inlineNavigationTitle()
            .screenBackground()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(model.cancelTitle) { onFinish(false) }
                }
            }
            .task { await model.loadTargets() }
        }
    }

    // MARK: - What the task is about

    private var targetSection: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            ChoiceChipGrid(
                fieldName: model.targetKindLabel,
                options: TaskTargetKind.allCases.map {
                    ChoiceChipGrid.Option(
                        value: $0,
                        label: model.targetKindName($0),
                        symbol: TaskSymbols.targetKind($0)
                    )
                },
                selection: $model.createTargetKind
            )
            .accessibilityIdentifier("tasks.create.targetKind")

            targetChoices
        }
    }

    @ViewBuilder
    private var targetChoices: some View {
        switch model.createTargetKind {
        case .garden:
            EmptyView()

        case .gardenArea:
            targetList(
                symbol: "square.dashed",
                isEmpty: model.targetAreas.isEmpty,
                rows: model.targetAreas.map { area in
                    (id: area.id, name: model.areaName(area), select: { model.selectArea(area) })
                },
                selectedId: model.createTargetGardenAreaMapObjectId
            )

        case .plant:
            targetList(
                symbol: "leaf",
                isEmpty: model.targetPlants.isEmpty,
                rows: model.targetPlants.map { plant in
                    (
                        id: plant.id,
                        name: model.plantName(plant),
                        select: { model.selectPlant(plant) }
                    )
                },
                selectedId: model.createTargetPlantId
            )
        }
    }

    /// A list of names, or an honest note that there are none to offer.
    ///
    /// An empty list is not a failure: a task is garden-wide by default, and a
    /// garden with no beds drawn yet is an ordinary garden.
    @ViewBuilder
    private func targetList(
        symbol: String,
        isEmpty: Bool,
        rows: [(id: String, name: String, select: () -> Void)],
        selectedId: String
    ) -> some View {
        if isEmpty {
            InlineMessage(model.mapObjectIdHint, tone: .neutral)
                .accessibilityIdentifier("tasks.create.targetEmpty")
        } else {
            VStack(spacing: Metrics.space2) {
                ForEach(rows, id: \.id) { row in
                    Button(action: row.select) {
                        SurfaceCard {
                            HStack(spacing: Metrics.space3) {
                                IconMedallion(
                                    symbol: symbol,
                                    label: row.name,
                                    tone: row.id == selectedId ? .positive : .neutral
                                )
                                Text(row.name)
                                    .font(FieldConsoleType.bodyStrong.font)
                                    .foregroundStyle(Palette.text)
                                Spacer(minLength: 0)
                                // A tick, not a colour alone: selection has to
                                // survive greyscale.
                                Image(systemName: row.id == selectedId
                                    ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle(
                                        row.id == selectedId ? Palette.interaction : Palette.border
                                    )
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(row.id == selectedId ? [.isSelected] : [])
                    .accessibilityIdentifier("tasks.create.target.\(row.id)")
                }
            }
        }
    }

    // MARK: - When

    /// An ordered scale reads as a rail rather than a menu: four values laid
    /// flat show the range and this task's place in it at once.
    private var urgencySection: some View {
        SegmentedRail(
            fieldName: model.urgencyLabel,
            options: TaskUrgency.allCases.map {
                SegmentedRail.Option(
                    value: $0,
                    label: model.urgencyName($0),
                    symbol: TaskSymbols.urgency($0)
                )
            },
            selection: $model.createUrgency
        )
        .accessibilityIdentifier("tasks.create.urgency")
    }

    private var dueDateSection: some View {
        OptionalValueCard(
            fieldName: model.dueDateLabel,
            addPrompt: model.dueDateToggleLabel,
            clearLabel: model.closeTitle,
            symbol: "calendar",
            displayValue: model.createHasDueDate ? TaskDateText.day(model.createDueDate) : nil,
            clear: { model.createHasDueDate = false }
        ) {
            DateDial(
                fieldName: model.dueDateLabel,
                selection: $model.createDueDate,
                now: .now,
                calendar: .current,
                chipTitle: model.relativeDayTitle,
                dayNumber: TaskDateText.dayNumber,
                weekdayName: TaskDateText.weekday,
                longDate: TaskDateText.day
            )
            // Opening the editor IS asking for the value. Making somebody flip
            // a switch first was the bookkeeping this card removed.
            .onAppear { model.createHasDueDate = true }
        }
        .accessibilityIdentifier("tasks.create.dueDate")
    }

    private var timeWindowSection: some View {
        OptionalValueCard(
            fieldName: model.timeWindowStartLabel,
            addPrompt: model.timeWindowToggleLabel,
            clearLabel: model.closeTitle,
            symbol: "clock",
            displayValue: model.createHasTimeWindow
                ? TaskDateText.window(model.createTimeWindowStart, model.createTimeWindowEnd)
                : nil,
            clear: { model.createHasTimeWindow = false }
        ) {
            TimeWindowBar(
                fieldName: model.timeWindowStartLabel,
                start: $model.createTimeWindowStart,
                end: $model.createTimeWindowEnd,
                calendar: .current,
                timeText: TaskDateText.time
            )
            .onAppear { model.createHasTimeWindow = true }
        }
        .accessibilityIdentifier("tasks.create.timeWindow")
    }

    private var isSubmitDisabled: Bool {
        model.isSubmittingCreate
            || model.createTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func submit() {
        guard !isSubmitDisabled else { return }

        Task {
            await model.submitCreateTask()
            onFinish(model.createErrorMessage == nil)
        }
    }
}
