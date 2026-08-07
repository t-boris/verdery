import CoreDesignSystem
import SwiftUI

/// The Calendar sub-view: every active plant's configured sow/transplant/
/// harvest windows, or its explicit `noSeasonalData` marker — never a plant
/// silently dropped, matching `SeasonalPlanResult.plants`'s own "never
/// omitted" contract guarantee.
///
/// The hemisphere-unknown empty state lives HERE, not in the parent view:
/// `hemisphere == nil` only ever suppresses reviewed seasonal-fact lookups,
/// which is exactly this sub-view's own data — the Rotation sub-view's
/// `family`/`priorFamily` come from the taxonomy reference itself, not a
/// hemisphere-scoped lookup, so it keeps rendering regardless of this state.
///
/// Source: tasks/todo.md, "P9D-UX-01 design decisions".
struct SeasonalCalendarSection: View {
    let model: SeasonalPlanViewModel
    let presentation: SeasonalPlanPresentation

    var body: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            SectionEyebrow(symbol: "calendar", title: model.calendarTitle)

            if !presentation.hemisphereKnown {
                hemisphereUnknown
            } else if presentation.calendarRows.isEmpty {
                SurfaceCard {
                    Text(model.calendarEmptyMessage)
                        .font(FieldConsoleType.detail.font)
                        .foregroundStyle(Palette.textMuted)
                }
                .accessibilityIdentifier("seasonalPlan.calendar.empty")
            } else {
                SurfaceCard {
                    VStack(alignment: .leading, spacing: Metrics.space3) {
                        ForEach(presentation.calendarRows) { row in
                            calendarRow(row)
                            if row.id != presentation.calendarRows.last?.id {
                                Divider()
                            }
                        }
                    }
                }
            }
        }
    }

    /// Links into the existing map/georeference calibration flow (the Map
    /// tab's own `MapEditorView`, reached here via `SeasonalPlanCalibrationRoute`
    /// — see that type's own doc comment for why a marker route, not a
    /// direct import, is how this feature reaches another feature's screen).
    private var hemisphereUnknown: some View {
        SurfaceCard {
            VStack(alignment: .leading, spacing: Metrics.space2) {
                Text(model.hemisphereUnknownTitle)
                    .font(FieldConsoleType.heading.font)
                    .foregroundStyle(Palette.text)
                Text(model.hemisphereUnknownDescription)
                    .font(FieldConsoleType.detail.font)
                    .foregroundStyle(Palette.textMuted)
                NavigationLink(value: SeasonalPlanCalibrationRoute(gardenId: model.gardenId)) {
                    Label(model.hemisphereUnknownLinkTitle, systemImage: "map")
                }
                .buttonStyle(SecondaryButtonStyle())
                .accessibilityIdentifier("seasonalPlan.calendar.calibrationLink")
            }
        }
        .accessibilityIdentifier("seasonalPlan.calendar.hemisphereUnknown")
    }

    private func calendarRow(_ row: SeasonalCalendarRow) -> some View {
        VStack(alignment: .leading, spacing: Metrics.space1) {
            // De-emphasized, never hidden: a `noSeasonalData` plant still
            // renders, only in the muted foreground.
            Text(row.plantLabel)
                .font(FieldConsoleType.body.font)
                .foregroundStyle(row.isDeemphasized ? Palette.textMuted : Palette.text)

            if let note = row.noteText {
                Text(note)
                    .font(FieldConsoleType.detail.font)
                    .foregroundStyle(Palette.textMuted)
            } else {
                ForEach(row.windowLines) { line in
                    HStack(spacing: Metrics.space2) {
                        Text(line.label)
                            .font(FieldConsoleType.detail.font)
                            .foregroundStyle(Palette.textMuted)
                        Spacer(minLength: 0)
                        Text(line.rangeText)
                            .font(FieldConsoleType.detail.font)
                            .foregroundStyle(Palette.text)
                    }
                }
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("seasonalPlan.calendar.row.\(row.id)")
    }
}
