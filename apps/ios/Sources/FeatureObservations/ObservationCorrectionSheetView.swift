import CoreDesignSystem
import CoreDomain
import SwiftUI

/// The "amend"/"supersede" sheet opened from a timeline row. Submitting
/// appends a new observation row that points back to the original — the
/// original stays visible and unmodified on the timeline underneath, never
/// edited in place.
struct ObservationCorrectionSheetView: View {
    let title: String
    let correctionKindLabel: String
    let noteTextLabel: String
    let conditionSummaryLabel: String
    let submitTitle: String
    let closeTitle: String
    let isSubmitting: Bool
    let errorMessage: String?
    let correctionKindName: (ObservationCorrectionKind) -> String
    let onSubmit: (ObservationCorrectionKind, String?, String?) async -> Void
    let onClose: () -> Void

    @State private var correctionKind: ObservationCorrectionKind = .amendment
    @State private var noteText: String = ""
    @State private var conditionSummary: String = ""

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Metrics.space4) {
                    // Amend or supersede: two values, and the difference
                    // between them is what happens to the original. Flat, so
                    // both are readable before choosing rather than after.
                    ChoiceChipGrid(
                        fieldName: correctionKindLabel,
                        options: ObservationCorrectionKind.allCases.map {
                            ChoiceChipGrid.Option(
                                value: $0,
                                label: correctionKindName($0),
                                symbol: $0 == .amendment ? "plus.bubble" : "arrow.uturn.backward"
                            )
                        },
                        selection: $correctionKind
                    )
                    .accessibilityIdentifier("observations.correction.kind")

                    NoteCanvas(
                        accessibilityName: noteTextLabel,
                        placeholder: noteTextLabel,
                        text: $noteText
                    )
                    .accessibilityIdentifier("observations.correction.noteField")

                    NoteCanvas(
                        accessibilityName: conditionSummaryLabel,
                        placeholder: conditionSummaryLabel,
                        text: $conditionSummary
                    )
                    .accessibilityIdentifier("observations.correction.conditionField")

                    if let errorMessage {
                        InlineMessage(errorMessage, tone: .negative)
                            .accessibilityIdentifier("observations.correction.failure")
                    }

                    Button(submitTitle) {
                        Task {
                            await onSubmit(
                                correctionKind,
                                noteText.isEmpty ? nil : noteText,
                                conditionSummary.isEmpty ? nil : conditionSummary
                            )
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(isSubmitting)
                    .accessibilityIdentifier("observations.correction.submit")
                }
                .padding(Metrics.space4)
            }
            .navigationTitle(title)
            .inlineNavigationTitle()
            .screenBackground()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(closeTitle, action: onClose)
                        .accessibilityIdentifier("observations.correction.close")
                }
            }
        }
    }
}
