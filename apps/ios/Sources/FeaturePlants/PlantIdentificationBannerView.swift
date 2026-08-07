import CoreDesignSystem
import CoreDomain
import SwiftUI

/// Shown when `AddPlantFromPhoto` (ADR-0015) left a suggestion this plant
/// has not yet confirmed or dismissed — a confirmable species guess, a
/// recordable condition/care guess, or both; absent entirely otherwise, the
/// same "real, working affordance or nothing" rule `PlantDetailView
/// .photoSection` follows for a `PlantDetailViewModel` built with no
/// `photoAttachment`. The species-confirmation block (name, confidence,
/// "Confirm") only renders for a resolved catalog entry or the AI's own raw
/// name guess (`suggestedCommonName`) — a genuine "no confident match"
/// species guess has nothing there to act on, but its condition/care guess
/// can still be worth recording as an observation on its own.
///
/// Split out of `PlantDetailView.swift` to keep that file under this
/// repository's 600-line ceiling (the same `PlantDetailMapObjectPickerTests
/// .swift` reason its own test file split out of the main one) — takes the
/// whole view model rather than narrow props since it reads a dozen of its
/// properties, the same `TodayItemDetailView`/`SyncConflictDetailView`
/// precedent for a tightly-coupled subview.
public struct PlantIdentificationBannerView: View {
    let model: PlantDetailViewModel

    public init(model: PlantDetailViewModel) {
        self.model = model
    }

    public var body: some View {
        if let identification = model.pendingIdentification,
            identification.hasConfirmableSuggestion || identification.suggestedConditionNote != nil
        {
            VStack(alignment: .leading, spacing: Metrics.space2) {
                SectionEyebrow(symbol: PlantSymbols.taxonomy, title: model.identificationSuggestedLabel)

                // An unconfirmed suggestion is a statement, not an alarm and
                // not a control: ADR-0015 requires it never auto-confirm, so
                // the card states what the model proposed and the Confirm
                // button below carries the interaction colour.
                SurfaceCard(tone: .neutral) {
                    VStack(alignment: .leading, spacing: Metrics.space2) {
                        Text(model.identificationPendingBanner)
                            .font(FieldConsoleType.detail.font)
                            .foregroundStyle(Palette.textMuted)

                        if identification.hasConfirmableSuggestion {
                            speciesSuggestion(identification)
                        }

                        detailRows(identification)

                        HStack(spacing: Metrics.space2) {
                            if identification.hasConfirmableSuggestion {
                                Button(model.identificationConfirmButtonTitle) {
                                    Task { await model.confirmPendingIdentification() }
                                }
                                .buttonStyle(PrimaryButtonStyle())
                                .accessibilityIdentifier("plants.detail.identification.confirm")
                            }

                            recordObservationButton(identification)
                        }

                        if model.observationSuggestion?.recordedConfirmation == true {
                            InlineMessage(model.observationRecordedMessage, tone: .positive)
                                .accessibilityIdentifier("plants.detail.identification.observationRecorded")
                        }
                        if let message = model.observationSuggestion?.errorMessage {
                            InlineMessage(message)
                                .accessibilityIdentifier("plants.detail.identification.observationFailure")
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func speciesSuggestion(_ identification: PlantIdentification) -> some View {
        if let suggestion = identification.suggestedTaxonomy {
            Text(model.identificationSuggestionDisplayName(suggestion))
                .font(FieldConsoleType.body.font.weight(.semibold))
                .accessibilityIdentifier("plants.detail.identification.suggestion")
        } else if let commonName = identification.suggestedCommonName {
            Text(model.rawIdentificationSuggestionDisplayName(
                commonName: commonName,
                scientificName: identification.suggestedScientificName
            ))
                .font(FieldConsoleType.body.font.weight(.semibold))
                .accessibilityIdentifier("plants.detail.identification.suggestion")
            Text(model.identificationUnlistedNote)
                .font(FieldConsoleType.detail.font)
                .foregroundStyle(Palette.textMuted)
                .accessibilityIdentifier("plants.detail.identification.unlistedNote")
        }
        Text(
            "\(model.identificationConfidenceLabel): "
                + model.identificationConfidenceText(identification.confidenceScore)
        )
        .font(FieldConsoleType.detail.font)
        .foregroundStyle(Palette.textMuted)
    }

    /// Independent of `identification.hasConfirmableSuggestion` — a
    /// condition/care guess is meaningful on its own even when the species
    /// guess itself had no confident catalog match.
    @ViewBuilder
    private func recordObservationButton(_ identification: PlantIdentification) -> some View {
        if let observationSuggestion = model.observationSuggestion, identification.suggestedConditionNote != nil {
            Button(model.recordObservationButtonTitle) {
                Task {
                    await observationSuggestion.record(
                        gardenId: model.gardenId, plantId: model.plantId, identificationId: identification.id
                    )
                }
            }
            .buttonStyle(SecondaryButtonStyle())
            .disabled(observationSuggestion.isRecording)
            .accessibilityIdentifier("plants.detail.identification.recordObservation")
        }
    }

    /// Variety, growth stage, condition, care-guidance, and acquisition-date
    /// guesses — the same supplementary rows `PlantAddFromPhotoSheetView
    /// .suggestionDetailRows` shows on the create-time review screen, so a
    /// suggestion left for "later" reads identically here. Each is an icon +
    /// label + value row, the same treatment `PlantSymbols` already gives
    /// every other plant fact, rather than a bare label/value pair.
    @ViewBuilder
    private func detailRows(_ identification: PlantIdentification) -> some View {
        VStack(alignment: .leading, spacing: Metrics.space3) {
            if let variety = identification.suggestedVarietyLabel {
                detailRow(
                    PlantSymbols.variety, model.identificationVarietyLabel, variety,
                    identifier: "plants.detail.identification.variety"
                )
            }
            if let stage = identification.suggestedLifecycleStage {
                detailRow(
                    PlantSymbols.lifecycleStage(stage),
                    model.identificationGrowthStageLabel,
                    model.identificationGrowthStageName(stage),
                    identifier: "plants.detail.identification.growthStage"
                )
            }
            if let condition = identification.suggestedConditionNote {
                detailRow(
                    PlantSymbols.condition, model.identificationConditionLabel, condition,
                    identifier: "plants.detail.identification.condition"
                )
            }
            if let careGuidance = identification.suggestedCareGuidanceNote {
                detailRow(
                    PlantSymbols.careGuidance, model.identificationCareGuidanceLabel, careGuidance,
                    identifier: "plants.detail.identification.careGuidance"
                )
            }
            if let acquisitionDate = identification.suggestedAcquisitionDate {
                detailRow(
                    PlantSymbols.acquisitionDateGuess, model.identificationAcquisitionDateLabel, acquisitionDate,
                    identifier: "plants.detail.identification.acquisitionDate"
                )
            }
        }
    }

    private func detailRow(_ symbol: String, _ label: String, _ value: String, identifier: String) -> some View {
        HStack(alignment: .top, spacing: Metrics.space2) {
            Image(systemName: symbol)
                .font(FieldConsoleType.body.font)
                .foregroundStyle(Palette.textMuted)
                .frame(width: Metrics.space5)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Metrics.space1) {
                Text(label)
                    .font(FieldConsoleType.detail.font)
                    .foregroundStyle(Palette.textMuted)
                Text(value)
                    .font(FieldConsoleType.body.font)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityIdentifier(identifier)
    }
}
