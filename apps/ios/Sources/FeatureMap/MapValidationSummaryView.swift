import CoreDomain
import CoreLocalization
import SwiftUI

/// Sheet listing the map document's server-reported validation issues
/// (`MapEditorViewModel.validationSummary`) — reachable from the map
/// editor's toolbar only while at least one issue exists. See
/// `MapValidationPresentation`'s doc comment for why this reliably renders
/// nothing against the real API today, and why that is not a sign of a
/// broken feature.
struct MapValidationSummaryView: View {
    let issues: [GardenMapValidationIssue]
    let objectsById: [String: GardenMapObject]
    let strings: LocalizedStrings
    /// Selects one of an issue's `affectedObjectIds` — reuses
    /// `MapEditorViewModel.selectFromList(_:)`, which also opens that
    /// object's property sheet, exactly like the accessible object list's
    /// own row tap.
    let onSelectObject: (String) -> Void
    let onClose: () -> Void

    var body: some View {
        NavigationStack {
            List(Array(issues.enumerated()), id: \.offset) { index, issue in
                row(for: issue, index: index)
            }
            .navigationTitle(strings(.mapWarningsTitle))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(strings(.mapWarningsClose), action: onClose)
                        .accessibilityIdentifier("map.warnings.close")
                }
            }
        }
    }

    private func row(for issue: GardenMapValidationIssue, index: Int) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 8) {
                // A distinct SF Symbol per severity, not just a tint — the
                // non-color state indicator `MapValidationPresentation`'s doc
                // comment explains.
                Image(systemName: MapValidationPresentation.symbolName(for: issue.severity))
                    .foregroundStyle(issue.severity == .error ? Color.red : Color.orange)
                VStack(alignment: .leading, spacing: 2) {
                    Text(MapValidationPresentation.text(forCode: issue.code, strings: strings))
                    Text(severityName(issue.severity))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .accessibilityElement(children: .combine)

            if !issue.affectedObjectIds.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(issue.affectedObjectIds, id: \.self) { objectId in
                            Button(affectedObjectLabel(objectId)) {
                                onSelectObject(objectId)
                            }
                            .buttonStyle(.bordered)
                            .font(.caption)
                            .accessibilityIdentifier("map.warnings.row.\(index).object.\(objectId)")
                        }
                    }
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityIdentifier("map.warnings.row.\(index)")
    }

    private func severityName(_ severity: ValidationSeverity) -> String {
        strings(severity == .error ? .mapValidationSeverityError : .mapValidationSeverityWarning)
    }

    /// A friendly label for one of an issue's affected objects — category
    /// plus title, resolved from the locally loaded document, falling back
    /// to the raw id when the object is not (or no longer) loaded.
    private func affectedObjectLabel(_ objectId: String) -> String {
        guard let object = objectsById[objectId] else { return objectId }
        let categoryName = MapCategoryLocalization.name(for: object.category, strings: strings)
        let title = object.label?.isEmpty == false ? object.label! : strings(.mapListUntitled)
        return "\(categoryName): \(title)"
    }
}
