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
            Form {
                Picker(correctionKindLabel, selection: $correctionKind) {
                    ForEach(ObservationCorrectionKind.allCases, id: \.self) { kind in
                        Text(correctionKindName(kind)).tag(kind)
                    }
                }
                .accessibilityIdentifier("observations.correction.kindPicker")

                TextField(noteTextLabel, text: $noteText, axis: .vertical)
                    .accessibilityIdentifier("observations.correction.noteField")
                TextField(conditionSummaryLabel, text: $conditionSummary, axis: .vertical)
                    .accessibilityIdentifier("observations.correction.conditionField")

                if let errorMessage {
                    Text(errorMessage).foregroundStyle(.red)
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
                .disabled(isSubmitting)
                .accessibilityIdentifier("observations.correction.submit")
            }
            .navigationTitle(title)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(closeTitle, action: onClose)
                        .accessibilityIdentifier("observations.correction.close")
                }
            }
        }
    }
}
