import CoreDomain
import SwiftUI

/// A single plant's detail screen: view, edit, lifecycle stage, status
/// (including delete), and move.
public struct PlantDetailView: View {
    @State private var model: PlantDetailViewModel

    public init(model: PlantDetailViewModel) {
        _model = State(wrappedValue: model)
    }

    public var body: some View {
        content
            .navigationTitle(model.title)
            .task { await model.load() }
    }

    @ViewBuilder
    private var content: some View {
        switch model.state {
        case .loading:
            ProgressView(model.loadingMessage)
                .accessibilityIdentifier("plants.detail.loading")

        case let .loaded(summary):
            Form {
                summarySection(summary)
                editSection
                lifecycleAndStatusSection(summary)
                moveSection

                if let message = model.actionErrorMessage {
                    Section {
                        Text(message).foregroundStyle(.red)
                            .accessibilityIdentifier("plants.detail.failure")
                    }
                }
            }

        case let .failed(message):
            VStack(alignment: .leading, spacing: 8) {
                Text(message)
                    .accessibilityIdentifier("plants.detail.loadFailure")
                Button(model.retryTitle) {
                    Task { await model.load() }
                }
            }
        }
    }

    private func summarySection(_ summary: PlantDetailSummary) -> some View {
        Section {
            Text(summary.displayName).font(.headline)
            Text(summary.groupingKindLabel).foregroundStyle(.secondary)
            if let quantity = summary.quantity {
                Text("\(model.quantityLabel): \(quantity)").foregroundStyle(.secondary)
            }
        }
    }

    private var editSection: some View {
        Section(model.editSectionTitle) {
            TextField(model.displayNameLabel, text: $model.editedDisplayName)
                .accessibilityIdentifier("plants.detail.displayNameField")
            TextField(model.varietyLabelLabel, text: $model.editedVarietyLabel)
                .accessibilityIdentifier("plants.detail.varietyLabelField")
            TextField(model.quantityLabel, text: $model.editedQuantityText)
                #if os(iOS)
                .keyboardType(.numberPad)
                #endif
                .accessibilityIdentifier("plants.detail.quantityField")

            Toggle(model.acquisitionDateToggleLabel, isOn: $model.editedHasAcquisitionDate)
                .accessibilityIdentifier("plants.detail.acquisitionDateToggle")
            if model.editedHasAcquisitionDate {
                DatePicker(
                    model.acquisitionDateLabel,
                    selection: $model.editedAcquisitionDate,
                    displayedComponents: .date
                )
                .accessibilityIdentifier("plants.detail.acquisitionDatePicker")

                Picker(model.acquisitionDateTypeLabel, selection: $model.editedAcquisitionDateType) {
                    ForEach(PlantAcquisitionDateType.allCases, id: \.self) { type in
                        Text(model.acquisitionDateTypeName(type)).tag(type)
                    }
                }
                .accessibilityIdentifier("plants.detail.acquisitionDateTypePicker")
            }

            TextField(model.conditionNoteLabel, text: $model.editedConditionNote, axis: .vertical)
                .accessibilityIdentifier("plants.detail.conditionNoteField")
            TextField(model.careGuidanceNoteLabel, text: $model.editedCareGuidanceNote, axis: .vertical)
                .accessibilityIdentifier("plants.detail.careGuidanceNoteField")

            Button(model.saveTitle) {
                Task { await model.saveDetails() }
            }
            .disabled(model.isSubmitting)
            .accessibilityIdentifier("plants.detail.save")
        }
    }

    private func lifecycleAndStatusSection(_ summary: PlantDetailSummary) -> some View {
        Section {
            Picker(model.lifecycleStageLabel, selection: lifecycleStageBinding(summary)) {
                ForEach(PlantLifecycleStage.allCases, id: \.self) { stage in
                    Text(model.lifecycleStageName(stage)).tag(stage)
                }
            }
            .disabled(model.isSubmitting)
            .accessibilityIdentifier("plants.detail.lifecycleStagePicker")

            Picker(model.statusLabel, selection: statusBinding(summary)) {
                ForEach(PlantStatus.allCases, id: \.self) { status in
                    Text(model.statusName(status)).tag(status)
                }
            }
            .disabled(model.isSubmitting)
            .accessibilityIdentifier("plants.detail.statusPicker")

            Button(model.deleteActionTitle, role: .destructive) {
                Task { await model.delete() }
            }
            .disabled(model.isSubmitting)
            .accessibilityIdentifier("plants.detail.delete")
        }
    }

    private var moveSection: some View {
        Section(model.moveSectionTitle) {
            TextField(model.gardenAreaLabel, text: $model.editedGardenAreaMapObjectId)
                .accessibilityIdentifier("plants.detail.gardenAreaField")
            TextField(model.placementLabel, text: $model.editedPlacementMapObjectId)
                .accessibilityIdentifier("plants.detail.placementField")
            Text(model.mapObjectIdHint)
                .font(.footnote)
                .foregroundStyle(.secondary)

            Button(model.moveSubmitTitle) {
                Task { await model.submitMove() }
            }
            .disabled(model.isSubmitting)
            .accessibilityIdentifier("plants.detail.moveSubmit")
        }
    }

    private func lifecycleStageBinding(_ summary: PlantDetailSummary) -> Binding<PlantLifecycleStage> {
        Binding(
            get: { summary.lifecycleStage },
            set: { newValue in Task { await model.transitionLifecycleStage(to: newValue) } }
        )
    }

    private func statusBinding(_ summary: PlantDetailSummary) -> Binding<PlantStatus> {
        Binding(
            get: { summary.status },
            set: { newValue in Task { await model.setStatus(newValue) } }
        )
    }
}
