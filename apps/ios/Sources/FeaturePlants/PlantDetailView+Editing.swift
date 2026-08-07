import CoreDesignSystem
import CoreDomain
import CoreLocalization
import SwiftUI

/// `PlantDetailView`'s editing half — the fields, the taxonomy row, the
/// placement rows, and the delete section.
///
/// Split out when the view crossed this repository's 600-line ceiling, along
/// the seam the screen already had: everything above reports what a plant is,
/// everything here changes it.
extension PlantDetailView {
    func editSection(_ summary: PlantDetailSummary) -> some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            SectionEyebrow(symbol: "pencil", title: model.editSectionTitle)

            SurfaceCard {
                VStack(alignment: .leading, spacing: Metrics.space3) {
                    iconField(PlantSymbols.displayName, model.displayNameLabel) {
                        TextField(model.displayNameLabel, text: $model.editedDisplayName)
                            .textFieldStyle(.roundedBorder)
                            .accessibilityIdentifier("plants.detail.displayNameField")
                    }

                    taxonomyRow

                    iconField(PlantSymbols.variety, model.varietyLabelLabel) {
                        TextField(model.varietyLabelLabel, text: $model.editedVarietyLabel)
                            .textFieldStyle(.roundedBorder)
                            .accessibilityIdentifier("plants.detail.varietyLabelField")
                    }

                    // Only a row or a group tracks a quantity — an
                    // `.individual` plant's server-side domain model rejects
                    // one outright (`quantity.not_allowed`), the same gate the
                    // add form already applies on creation.
                    if summary.groupingKind != .individual {
                        iconField(PlantSymbols.quantity, model.quantityLabel) {
                            TextField(model.quantityLabel, text: $model.editedQuantityText)
                                .textFieldStyle(.roundedBorder)
                                #if os(iOS)
                                    .keyboardType(.numberPad)
                                #endif
                                .accessibilityIdentifier("plants.detail.quantityField")
                        }
                    }

                    Toggle(isOn: $model.editedHasAcquisitionDate) {
                        Label(model.acquisitionDateToggleLabel, systemImage: PlantSymbols.acquisitionDateGuess)
                    }
                    .accessibilityIdentifier("plants.detail.acquisitionDateToggle")
                    if model.editedHasAcquisitionDate {
                        DatePicker(
                            model.acquisitionDateLabel,
                            selection: $model.editedAcquisitionDate,
                            displayedComponents: .date
                        )
                        .accessibilityIdentifier("plants.detail.acquisitionDatePicker")

                        HStack(spacing: Metrics.space2) {
                            ForEach(PlantAcquisitionDateType.allCases, id: \.self) { type in
                                PlantChoiceChip(
                                    symbol: PlantSymbols.acquisitionDateType(type),
                                    label: model.acquisitionDateTypeName(type),
                                    isSelected: model.editedAcquisitionDateType == type
                                ) {
                                    model.editedAcquisitionDateType = type
                                }
                            }
                            Spacer(minLength: 0)
                        }
                        .accessibilityIdentifier("plants.detail.acquisitionDateTypePicker")
                    }

                    iconField(PlantSymbols.condition, model.conditionNoteLabel) {
                        TextField(
                            model.conditionNoteLabel, text: $model.editedConditionNote, axis: .vertical
                        )
                        .textFieldStyle(.roundedBorder)
                        .lineLimit(2...4)
                        .accessibilityIdentifier("plants.detail.conditionNoteField")
                    }

                    iconField(PlantSymbols.careGuidance, model.careGuidanceNoteLabel) {
                        TextField(
                            model.careGuidanceNoteLabel,
                            text: $model.editedCareGuidanceNote,
                            axis: .vertical
                        )
                        .textFieldStyle(.roundedBorder)
                        .lineLimit(2...4)
                        .accessibilityIdentifier("plants.detail.careGuidanceNoteField")
                    }

                    Button {
                        Task {
                            await model.saveDetails()
                            Haptics.play(model.actionErrorMessage == nil ? .success : .failure)
                        }
                    } label: {
                        Label(model.saveTitle, systemImage: "checkmark")
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(model.isSubmitting)
                    .accessibilityIdentifier("plants.detail.save")
                }
            }
            .tint(Palette.interaction)
        }
    }

    /// The detail screen's read-and-change affordance for an existing plant's
    /// identification, mirroring the add sheet's own taxonomy row.
    private var taxonomyRow: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            Button {
                model.isTaxonomyPickerPresented = true
            } label: {
                HStack(spacing: Metrics.space2) {
                    Image(systemName: PlantSymbols.taxonomy)
                        .foregroundStyle(Palette.textMuted)
                        .accessibilityHidden(true)
                    Text(model.taxonomyLabel)
                        .font(Typography.body)
                        .foregroundStyle(Palette.text)
                    Spacer(minLength: 0)
                    Text(model.selectedTaxonomySummary)
                        .font(Typography.detail)
                        .foregroundStyle(Palette.textMuted)
                        .lineLimit(1)
                    Image(systemName: "chevron.right")
                        .font(Typography.detail)
                        .foregroundStyle(Palette.textMuted)
                        .accessibilityHidden(true)
                }
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("plants.detail.taxonomyRow")

            if model.editedTaxonomyReferenceId != nil {
                Button(model.taxonomyClearLabel) { model.clearTaxonomy() }
                    .font(Typography.detail)
                    .tint(Palette.negative)
                    .accessibilityIdentifier("plants.detail.taxonomyClear")
            }
        }
    }

    var mapObjectPickerPresented: Binding<Bool> {
        Binding(
            get: { model.activeMapObjectField != nil },
            set: { if !$0 { model.activeMapObjectField = nil } }
        )
    }

    private func mapObjectRow(_ label: String, field: MapObjectPlacementField) -> some View {
        Button {
            Task { await model.openMapObjectPicker(for: field) }
        } label: {
            HStack {
                Text(label)
                    .foregroundStyle(Palette.text)
                Spacer(minLength: 0)
                Text(model.mapObjectSummary(for: field) ?? model.mapObjectPickerClearTitle)
                    .foregroundStyle(Palette.textMuted)
                Image(systemName: "chevron.right")
                    .foregroundStyle(Palette.textMuted)
                    .accessibilityHidden(true)
            }
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(field == .gardenArea ? "plants.detail.gardenAreaField" : "plants.detail.placementField")
    }

    var moveSection: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            SectionEyebrow(symbol: PlantSymbols.placement, title: model.moveSectionTitle)

            SurfaceCard {
                VStack(alignment: .leading, spacing: Metrics.space3) {
                    mapObjectRow(model.gardenAreaLabel, field: .gardenArea)
                    mapObjectRow(model.placementLabel, field: .placement)
                    InlineMessage(model.mapObjectIdHint, tone: .neutral)

                    Button {
                        Task {
                            await model.submitMove()
                            Haptics.play(model.actionErrorMessage == nil ? .success : .failure)
                        }
                    } label: {
                        Label(model.moveSubmitTitle, systemImage: "arrow.right")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                    .disabled(model.isSubmitting)
                    .accessibilityIdentifier("plants.detail.moveSubmit")
                }
            }
        }
    }

    /// Deleting a plant is irreversible from here, so it confirms — it used to
    /// be a bare destructive row inside the same section as two pickers, easy
    /// to miss. Its own negative-tone card now gives it the visual weight a
    /// destructive, screen-ending action deserves, the same `SurfaceCard
    /// (tone:)`/`SecondaryButtonStyle(tone:)` red treatment the identification
    /// banner already establishes for `.accent`.
    var deleteSection: some View {
        SurfaceCard(tone: .negative) {
            VStack(alignment: .leading) {
                Button {
                    isDeleteConfirmationPresented = true
                } label: {
                    Label(model.deleteActionTitle, systemImage: "trash")
                }
                .buttonStyle(SecondaryButtonStyle(tone: .negative))
                .disabled(model.isSubmitting)
                .accessibilityIdentifier("plants.detail.delete")
            }
        }
    }
}
