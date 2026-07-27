import CoreDesignSystem
import CoreDomain
import SwiftUI

/// One `GardenContextKind` row: the declared value, its source, and — only
/// when `source == .horticulturallyReviewedDefault` — who reviewed it and
/// when, so a reader can tell at a glance whether a fact is a member's own
/// declaration or an operator default (FR-22). The declaring member is
/// shown as the raw `recordedByProfileId` — this codebase's own established
/// convention (`TodayViewModel.targetLabel`'s identical raw-id fallback);
/// there is no member display-name field anywhere in this API.
///
/// The edit disclosure renders only when `canEdit` is true — the caller-role
/// gate `ContextQualityViewModel.canEdit` resolves, matching
/// `GardenSettingsView`'s own `summary.isOwner &&` pattern for hiding a
/// mutation the server would reject anyway.
struct ContextQualityRowView: View {
    let model: ContextQualityViewModel
    let row: ContextQualityRow

    @State private var isEditing = false
    @State private var editedValue = ""
    @State private var showRequiredError = false

    var body: some View {
        SurfaceCard {
            VStack(alignment: .leading, spacing: Metrics.space2) {
                HStack(alignment: .top, spacing: Metrics.space3) {
                    Text(row.kindLabel)
                        .font(Typography.heading)
                        .foregroundStyle(Palette.text)
                    Spacer(minLength: 0)
                    if model.canEdit {
                        Button {
                            editedValue = row.fact?.value ?? defaultEditedValue
                            isEditing.toggle()
                        } label: {
                            Text(row.fact == nil ? model.declareTitle : model.editTitle)
                        }
                        .buttonStyle(SecondaryButtonStyle())
                        .accessibilityIdentifier("contextQuality.row.\(row.id.rawValue).edit")
                    }
                }

                if let fact = row.fact {
                    Text(row.valueDisplayText ?? fact.value)
                        .font(Typography.body)
                        .foregroundStyle(Palette.text)
                    if let sourceLabel = row.sourceLabel {
                        Text(sourceLabel)
                            .font(Typography.detail)
                            .foregroundStyle(Palette.textMuted)
                    }
                    if let reviewedDisplayText = row.reviewedDisplayText {
                        Text(reviewedDisplayText)
                            .font(Typography.detail)
                            .foregroundStyle(Palette.textMuted)
                    }
                    if let recordedByDisplayText = row.recordedByDisplayText {
                        Text(recordedByDisplayText)
                            .font(Typography.detail)
                            .foregroundStyle(Palette.textMuted)
                    }
                } else {
                    Text(model.notDeclaredMessage)
                        .font(Typography.detail)
                        .foregroundStyle(Palette.textMuted)
                }

                if isEditing {
                    editForm
                }
            }
        }
        .accessibilityIdentifier("contextQuality.row.\(row.id.rawValue)")
    }

    private var defaultEditedValue: String {
        model.valueOptions(for: row.id)?.first?.value ?? ""
    }

    @ViewBuilder
    private var editForm: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            if let options = model.valueOptions(for: row.id) {
                Picker(model.valueLabel, selection: $editedValue) {
                    ForEach(options, id: \.value) { option in
                        Text(option.label).tag(option.value)
                    }
                }
            } else {
                TextField(model.valueLabel, text: $editedValue)
                    .textFieldStyle(.roundedBorder)
                    .accessibilityIdentifier("contextQuality.row.\(row.id.rawValue).valueField")
            }

            if showRequiredError {
                InlineMessage(model.valueRequiredMessage)
                    .accessibilityIdentifier("contextQuality.row.\(row.id.rawValue).requiredError")
            }

            if let message = model.actionErrorMessage {
                InlineMessage(message)
                    .accessibilityIdentifier("contextQuality.row.\(row.id.rawValue).failure")
            }

            HStack(spacing: Metrics.space2) {
                Button(model.saveTitle) {
                    let trimmed = editedValue.trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !trimmed.isEmpty else {
                        showRequiredError = true
                        return
                    }
                    showRequiredError = false
                    Task {
                        if await model.record(contextKind: row.id, value: trimmed) {
                            isEditing = false
                        }
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(model.isSubmitting)
                .accessibilityIdentifier("contextQuality.row.\(row.id.rawValue).save")

                Button(model.cancelEditTitle) {
                    isEditing = false
                }
                .buttonStyle(SecondaryButtonStyle())
            }
        }
        .padding(.top, Metrics.space1)
    }
}
