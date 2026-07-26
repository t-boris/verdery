import CoreDesignSystem
import CoreDomain
import SwiftUI

/// The create-a-task sheet.
///
/// Extracted from `TasksListView`, where the same eleven controls were a
/// permanently expanded `Section` between the filter and the tasks — so the
/// list a person opened the screen to read began below the fold, and every
/// optional field was on screen whether or not it was wanted.
///
/// Three things make it quicker than the section it replaces: the title field
/// takes focus on appear, so the sheet opens ready to type; urgency and target
/// kind are chip rows rather than `Picker`s, so choosing one is a tap instead
/// of a tap-scroll-tap; and the date controls stay collapsed behind their own
/// toggles, which is where they already were but now without the eight other
/// fields competing for the same space.
///
/// The submit control is disabled until the title is non-empty, rather than
/// accepting the tap and answering with an error afterwards.
struct TaskCreateSheetView: View {
    @Bindable var model: TasksListViewModel
    let onFinish: (Bool) -> Void

    @FocusState private var isTitleFocused: Bool

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Metrics.space5) {
                    titleSection
                    targetSection
                    urgencySection
                    schedulingSection

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
                // A Done key over the keyboard: several fields here are
                // multi-line, where Return inserts a newline rather than
                // dismissing, so without this the keyboard could only be
                // dismissed by dragging.
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button(model.closeTitle) { isTitleFocused = false }
                }
            }
            .onAppear { isTitleFocused = true }
        }
    }

    private var titleSection: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            SectionEyebrow(symbol: "text.alignleft", title: model.titleLabel)
            SurfaceCard {
                VStack(alignment: .leading, spacing: Metrics.space3) {
                    TextField(model.titleLabel, text: $model.createTitle)
                        .textFieldStyle(.roundedBorder)
                        .focused($isTitleFocused)
                        .accessibilityIdentifier("tasks.create.titleField")

                    TextField(model.notesLabel, text: $model.createNotes, axis: .vertical)
                        .textFieldStyle(.roundedBorder)
                        .lineLimit(2...4)
                        .accessibilityIdentifier("tasks.create.notesField")
                }
            }
        }
    }

    private var targetSection: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            SectionEyebrow(symbol: "scope", title: model.targetKindLabel)

            HStack(spacing: Metrics.space2) {
                ForEach(TaskTargetKind.allCases, id: \.self) { kind in
                    selectableChip(
                        symbol: TaskSymbols.targetKind(kind),
                        label: model.targetKindName(kind),
                        isSelected: model.createTargetKind == kind
                    ) {
                        model.createTargetKind = kind
                    }
                }
                Spacer(minLength: 0)
            }
            .accessibilityIdentifier("tasks.create.targetKindPicker")

            if model.createTargetKind != .garden {
                SurfaceCard {
                    VStack(alignment: .leading, spacing: Metrics.space2) {
                        if model.createTargetKind == .gardenArea {
                            TextField(
                                model.targetGardenAreaLabel,
                                text: $model.createTargetGardenAreaMapObjectId
                            )
                            .textFieldStyle(.roundedBorder)
                            .accessibilityIdentifier("tasks.create.targetGardenAreaField")
                        }
                        if model.createTargetKind == .plant {
                            TextField(model.targetPlantLabel, text: $model.createTargetPlantId)
                                .textFieldStyle(.roundedBorder)
                                .accessibilityIdentifier("tasks.create.targetPlantField")
                        }
                        InlineMessage(model.mapObjectIdHint, tone: .info)
                    }
                }
            }
        }
    }

    private var urgencySection: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            SectionEyebrow(symbol: "flame", title: model.urgencyLabel)

            HStack(spacing: Metrics.space2) {
                ForEach(TaskUrgency.allCases, id: \.self) { urgency in
                    selectableChip(
                        symbol: TaskSymbols.urgency(urgency),
                        label: model.urgencyName(urgency),
                        isSelected: model.createUrgency == urgency,
                        tone: TaskSymbols.urgencyTone(urgency)
                    ) {
                        model.createUrgency = urgency
                    }
                }
                Spacer(minLength: 0)
            }
            .accessibilityIdentifier("tasks.create.urgencyPicker")
        }
    }

    private var schedulingSection: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            SectionEyebrow(symbol: "calendar", title: model.dueDateLabel)

            SurfaceCard {
                VStack(alignment: .leading, spacing: Metrics.space3) {
                    Toggle(model.dueDateToggleLabel, isOn: $model.createHasDueDate)
                        .accessibilityIdentifier("tasks.create.dueDateToggle")
                    if model.createHasDueDate {
                        DatePicker(
                            model.dueDateLabel,
                            selection: $model.createDueDate,
                            displayedComponents: .date
                        )
                        .accessibilityIdentifier("tasks.create.dueDatePicker")
                    }

                    Divider()

                    Toggle(model.timeWindowToggleLabel, isOn: $model.createHasTimeWindow)
                        .accessibilityIdentifier("tasks.create.timeWindowToggle")
                    if model.createHasTimeWindow {
                        DatePicker(
                            model.timeWindowStartLabel,
                            selection: $model.createTimeWindowStart
                        )
                        .accessibilityIdentifier("tasks.create.timeWindowStartPicker")
                        DatePicker(model.timeWindowEndLabel, selection: $model.createTimeWindowEnd)
                            .accessibilityIdentifier("tasks.create.timeWindowEndPicker")
                    }
                }
            }
            .tint(Palette.accent)
        }
    }

    /// A chip that is also a control.
    ///
    /// The selected one is outlined as well as filled, so selection is not
    /// carried by colour alone, and it declares the `isSelected` trait so
    /// VoiceOver announces which is chosen.
    private func selectableChip(
        symbol: String,
        label: String,
        isSelected: Bool,
        tone: Tone = .accent,
        action: @escaping () -> Void
    ) -> some View {
        Button {
            action()
            Haptics.play(.selection)
        } label: {
            Chip(symbol: symbol, label: label, tone: isSelected ? tone : .neutral)
                .overlay(
                    Capsule(style: .continuous)
                        .strokeBorder(
                            isSelected ? tone.foreground : Color.clear,
                            lineWidth: Metrics.hairline
                        )
                )
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
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
