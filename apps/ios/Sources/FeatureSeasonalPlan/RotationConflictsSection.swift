import CoreDesignSystem
import SwiftUI

/// The Rotation sub-view: `SeasonalPlanResult.rotationStatus` split into the
/// "conflicts" this package's brief names (`withinRestPeriod == true`, shown
/// prominently with a warning-toned `Chip`) and every other tracked bed
/// (available behind a `DisclosureGroup`, never alarmed over — no warning
/// styling on those).
///
/// Reuses `Chip`/`SurfaceCard`, the same components `TodayView` uses for its
/// own urgency/elevated-risk chips, per this package's own "do not invent
/// new components" instruction.
///
/// Source: tasks/todo.md, "P9D-UX-01 design decisions".
struct RotationConflictsSection: View {
    let model: SeasonalPlanViewModel
    let presentation: SeasonalPlanPresentation

    @State private var othersExpanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            SectionEyebrow(symbol: "arrow.triangle.2.circlepath", title: model.rotationTitle)

            if presentation.rotationConflicts.isEmpty {
                SurfaceCard {
                    Text(model.rotationConflictsEmptyMessage)
                        .font(FieldConsoleType.detail.font)
                        .foregroundStyle(Palette.textMuted)
                }
                .accessibilityIdentifier("seasonalPlan.rotation.conflictsEmpty")
            } else {
                VStack(spacing: Metrics.space2) {
                    ForEach(presentation.rotationConflicts) { row in
                        conflictCard(row)
                    }
                }
            }

            if !presentation.rotationOthers.isEmpty {
                DisclosureGroup(
                    othersExpanded ? model.rotationHideOthersTitle : model.rotationShowOthersTitle,
                    isExpanded: $othersExpanded
                ) {
                    VStack(alignment: .leading, spacing: Metrics.space2) {
                        ForEach(presentation.rotationOthers) { row in
                            otherRow(row)
                        }
                    }
                    .padding(.top, Metrics.space2)
                }
                .accessibilityIdentifier("seasonalPlan.rotation.othersDisclosure")
            }
        }
    }

    private func conflictCard(_ row: RotationStatusRow) -> some View {
        SurfaceCard(tone: .warning) {
            VStack(alignment: .leading, spacing: Metrics.space2) {
                HStack(spacing: Metrics.space2) {
                    Text(row.plantLabel)
                        .font(FieldConsoleType.body.font)
                        .foregroundStyle(Palette.text)
                    Spacer(minLength: 0)
                    Chip(symbol: "exclamationmark.triangle.fill", label: model.rotationConflictBadgeLabel, tone: .warning)
                }
                Text(row.descriptionText)
                    .font(FieldConsoleType.detail.font)
                    .foregroundStyle(Palette.textMuted)
            }
        }
        .accessibilityIdentifier("seasonalPlan.rotation.conflict.\(row.id)")
    }

    private func otherRow(_ row: RotationStatusRow) -> some View {
        VStack(alignment: .leading, spacing: Metrics.space1) {
            Text(row.plantLabel)
                .font(FieldConsoleType.body.font)
                .foregroundStyle(Palette.text)
            Text(row.descriptionText)
                .font(FieldConsoleType.detail.font)
                .foregroundStyle(Palette.textMuted)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("seasonalPlan.rotation.other.\(row.id)")
    }
}
