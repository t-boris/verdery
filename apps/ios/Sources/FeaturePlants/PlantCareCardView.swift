import CoreDesignSystem
import CoreDomain
import SwiftUI

/// "I opened this plant — what do I do with it?"
///
/// One card, three answers, each of which says plainly when it does not know:
/// what wants doing, what the sky has been doing, and how much rain the garden
/// has actually had. Nothing here is a new server concept — it is the tasks and
/// suggestions that already name this plant, beside the readings the watering
/// rule already read.
struct PlantCareCardView: View {
    let controller: PlantCareController
    /// Opening the thing itself. Absent on screens with nowhere to go, in which
    /// case the row is text rather than a dead button.
    let open: ((PlantCareAction) -> Void)?

    var body: some View {
        if let digest = controller.digest {
            VStack(alignment: .leading, spacing: Metrics.space4) {
                actions(digest)
                if digest.hasConditions || digest.conditionsUnknown {
                    conditions(digest)
                }
            }
        }
    }

    // MARK: - What to do

    @ViewBuilder
    private func actions(_ digest: PlantCareDigest) -> some View {
        VStack(alignment: .leading, spacing: Metrics.space3) {
            SectionEyebrow(symbol: "checklist", title: controller.title)

            if digest.actions.isEmpty {
                // Two different sentences on purpose. "Nothing to do" is a
                // finding; "we could not ask" is not, and reading the second as
                // the first is how somebody misses a watering.
                if digest.proposalsUnknown {
                    InlineMessage(controller.proposalsUnknownText, tone: .warning)
                        .accessibilityIdentifier("care.proposalsUnknown")
                } else {
                    EmptyStateView(
                        symbol: "checkmark.seal",
                        title: controller.nothingToDoTitle,
                        message: controller.nothingToDoDetail
                    )
                    .accessibilityIdentifier("care.settled")
                }
            } else {
                ForEach(digest.actions) { action in
                    actionRow(action)
                }
                if digest.proposalsUnknown {
                    Text(controller.proposalsUnknownText)
                        .font(FieldConsoleType.secondary.font)
                        .foregroundStyle(Palette.textMuted)
                }
            }
        }
    }

    @ViewBuilder
    private func actionRow(_ action: PlantCareAction) -> some View {
        let row = SurfaceCard {
            VStack(alignment: .leading, spacing: Metrics.space2) {
                HStack(spacing: Metrics.space2) {
                    Chip(
                        symbol: controller.originSymbol(action.origin),
                        label: controller.originLabel(action.origin),
                        tone: controller.tone(for: action.urgency)
                    )
                    Spacer(minLength: 0)
                    if let dueBy = action.dueBy {
                        Text(controller.dueText(dueBy))
                            .font(FieldConsoleType.mono.font)
                            .foregroundStyle(Palette.textMuted)
                    }
                }

                Text(action.title)
                    .font(FieldConsoleType.bodyStrong.font)
                    .foregroundStyle(Palette.text)
                    .multilineTextAlignment(.leading)

                // The rule's own stored explanation, rendered at generation
                // time against the facts it actually fired on. That IS the
                // "what is this plant short of" answer, said by the thing that
                // decided it rather than re-derived here and possibly differing.
                if let detail = action.detail, !detail.isEmpty {
                    Text(detail)
                        .font(FieldConsoleType.secondary.font)
                        .foregroundStyle(Palette.textMuted)
                        .multilineTextAlignment(.leading)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }

        if let open {
            Button { open(action) } label: { row }
                .buttonStyle(.plain)
                .accessibilityIdentifier("care.action")
        } else {
            row.accessibilityIdentifier("care.action")
        }
    }

    // MARK: - Conditions

    @ViewBuilder
    private func conditions(_ digest: PlantCareDigest) -> some View {
        VStack(alignment: .leading, spacing: Metrics.space3) {
            SectionEyebrow(symbol: "cloud.sun", title: controller.conditionsTitle)

            if digest.conditionsUnknown {
                InlineMessage(controller.conditionsUnknownText, tone: .neutral)
                    .accessibilityIdentifier("care.conditionsUnknown")
            } else {
                if let reading = digest.conditions {
                    ReadingGrid(cells: controller.measurementCells(reading))
                        .accessibilityIdentifier("care.conditions")
                    if reading.isStale {
                        // Kept and labelled rather than hidden: it is still the
                        // most recent reading this garden has, and the rules
                        // branch on exactly this distinction.
                        Chip(symbol: "clock.badge.exclamationmark", label: controller.staleLabel, tone: .warning)
                        Text(controller.staleExplanation)
                            .font(FieldConsoleType.secondary.font)
                            .foregroundStyle(Palette.textMuted)
                    }
                } else if !digest.hasConditions {
                    Text(controller.unavailableText)
                        .font(FieldConsoleType.secondary.font)
                        .foregroundStyle(Palette.textMuted)
                        .accessibilityIdentifier("care.conditionsUnavailable")
                }

                rainfall(digest)
            }

            // A licence obligation carried by the reading's own provider terms,
            // not a courtesy — so it is rendered whenever a reading is.
            if let attribution = digest.attributionText {
                Text(attribution)
                    .font(FieldConsoleType.detail.font)
                    .foregroundStyle(Palette.textMuted)
            }
        }
    }

    @ViewBuilder
    private func rainfall(_ digest: PlantCareDigest) -> some View {
        if let rainfall = digest.rainfall, !rainfall.days.isEmpty {
            VStack(alignment: .leading, spacing: Metrics.space2) {
                HStack {
                    Text(controller.rainfallTitle(rainfall))
                        .font(FieldConsoleType.label.font)
                        .foregroundStyle(Palette.textMuted)
                    Spacer(minLength: 0)
                    Text(controller.rainfallTotal(rainfall))
                        .font(FieldConsoleType.monoStrong.font)
                        .foregroundStyle(Palette.text)
                }

                RainfallBars(
                    bars: controller.rainfallBars(rainfall),
                    summary: controller.rainfallSummary(rainfall)
                )
                .accessibilityIdentifier("care.rainfall")

                if rainfall.isMeasuredDry {
                    Text(controller.rainfallDryText)
                        .font(FieldConsoleType.secondary.font)
                        .foregroundStyle(Palette.textMuted)
                }

                // Said out loud, because the honest reading of this number is
                // not the obvious one: rain is measured over the garden, and a
                // plant under a canopy got a different amount.
                Text(controller.gardenRainfallNote)
                    .font(FieldConsoleType.detail.font)
                    .foregroundStyle(Palette.textMuted)
            }
        } else if digest.conditions != nil || digest.forecast != nil {
            // Readings exist but no rainfall history does. "Unknown" is not
            // "dry", and the sentence says which one this is.
            Text(controller.rainfallNoneText)
                .font(FieldConsoleType.secondary.font)
                .foregroundStyle(Palette.textMuted)
                .accessibilityIdentifier("care.rainfallNone")
        }
    }
}
