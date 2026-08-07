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

            VStack(alignment: .leading, spacing: Metrics.space3) {
                    ComposerField(
                        symbol: PlantSymbols.displayName,
                        accessibilityName: model.displayNameLabel,
                        placeholder: model.displayNameLabel,
                        commitLabel: model.saveTitle,
                        text: $model.editedDisplayName,
                        commit: saveDetails
                    )
                    .accessibilityIdentifier("plants.detail.displayNameField")

                    SurfaceCard { taxonomyRow }

                    ComposerField(
                        symbol: PlantSymbols.variety,
                        accessibilityName: model.varietyLabelLabel,
                        placeholder: model.varietyLabelLabel,
                        commitLabel: model.saveTitle,
                        text: $model.editedVarietyLabel,
                        commit: saveDetails
                    )
                    .accessibilityIdentifier("plants.detail.varietyLabelField")

                    // Only a row or a group tracks a quantity — an
                    // `.individual` plant's server-side domain model rejects
                    // one outright (`quantity.not_allowed`), the same gate the
                    // add form already applies on creation.
                    if summary.groupingKind != .individual {
                        MeasureField(
                            fieldName: model.quantityLabel,
                            unitLabel: model.quantityUnitLabel,
                            decreaseLabel: model.quantityDecreaseLabel,
                            increaseLabel: model.quantityIncreaseLabel,
                            value: quantityBinding,
                            step: 1,
                            range: 1...9_999,
                            fractionDigits: 0,
                            locale: .autoupdatingCurrent
                        )
                        .accessibilityIdentifier("plants.detail.quantityField")
                    }

                    OptionalValueCard(
                        fieldName: model.acquisitionDateLabel,
                        addPrompt: model.acquisitionDateToggleLabel,
                        clearLabel: model.closeTitle,
                        symbol: PlantSymbols.acquisitionDateGuess,
                        displayValue: model.editedHasAcquisitionDate
                            ? CalendarText.day(model.editedAcquisitionDate) : nil,
                        clear: { model.editedHasAcquisitionDate = false }
                    ) {
                        VStack(alignment: .leading, spacing: Metrics.space3) {
                            DateDial(
                                fieldName: model.acquisitionDateLabel,
                                selection: $model.editedAcquisitionDate,
                                now: .now,
                                calendar: .current,
                                chipTitle: model.relativeDayTitle,
                                dayNumber: CalendarText.dayNumber,
                                weekdayName: CalendarText.weekday,
                                longDate: CalendarText.day
                            )
                            .onAppear { model.editedHasAcquisitionDate = true }

                            ChoiceChipGrid(
                                fieldName: model.acquisitionDateLabel,
                                options: PlantAcquisitionDateType.allCases.map {
                                    ChoiceChipGrid.Option(
                                        value: $0,
                                        label: model.acquisitionDateTypeName($0),
                                        symbol: PlantSymbols.acquisitionDateType($0)
                                    )
                                },
                                selection: $model.editedAcquisitionDateType
                            )
                            .accessibilityIdentifier("plants.detail.acquisitionDateType")
                        }
                    }
                    .accessibilityIdentifier("plants.detail.acquisitionDate")

                    // Two notes, and notes are content rather than controls:
                    // borderless paper, no box drawn around prose.
                    NoteCanvas(
                        accessibilityName: model.conditionNoteLabel,
                        placeholder: model.conditionNoteLabel,
                        text: $model.editedConditionNote
                    )
                    .accessibilityIdentifier("plants.detail.conditionNoteField")

                    NoteCanvas(
                        accessibilityName: model.careGuidanceNoteLabel,
                        placeholder: model.careGuidanceNoteLabel,
                        text: $model.editedCareGuidanceNote
                    )
                    .accessibilityIdentifier("plants.detail.careGuidanceNoteField")

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
    }

    /// The composer fields commit to the same place the Save button does, so
    /// pressing Return finishes the edit rather than doing nothing.
    private func saveDetails() {
        Task {
            await model.saveDetails()
            Haptics.play(model.actionErrorMessage == nil ? .success : .failure)
        }
    }

    /// The model holds the count as text, because that is what the command
    /// payload carries. The nudgeable numeral works in numbers, so the two meet
    /// here — an unparsable or absent value reads as one.
    private var quantityBinding: Binding<Double> {
        Binding(
            get: { Double(model.editedQuantityText) ?? 1 },
            set: { model.editedQuantityText = String(Int($0.rounded())) }
        )
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
