import CoreDomain
import SwiftUI

/// Sheet presented from the add/edit candidate form's taxonomy field:
/// searches `SearchTaxonomyReferences` and lets the user pick one result, or
/// leave the candidate unidentified. Duplicates
/// `FeaturePlants.TaxonomyReferencePickerView` verbatim rather than
/// importing it — see `CandidatesLocalization`'s own doc comment for why.
struct CandidateTaxonomyReferencePickerView: View {
    let title: String
    let searchLabel: String
    let emptyMessage: String
    let closeTitle: String
    let displayName: (TaxonomyReference) -> String
    let search: (String) async -> [TaxonomyReference]
    let onSelect: (TaxonomyReference) -> Void
    let onClose: () -> Void

    @State private var query: String = ""
    @State private var results: [TaxonomyReference] = []
    @State private var isSearching = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                HStack {
                    TextField(searchLabel, text: $query)
                        .textFieldStyle(.roundedBorder)
                        .accessibilityIdentifier("candidates.taxonomyPicker.searchField")
                        .onSubmit { Task { await runSearch() } }

                    Button {
                        Task { await runSearch() }
                    } label: {
                        Image(systemName: "magnifyingglass")
                    }
                    .accessibilityLabel(searchLabel)
                    .accessibilityIdentifier("candidates.taxonomyPicker.searchSubmit")
                }
                .padding()

                if isSearching {
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if results.isEmpty {
                    Text(emptyMessage)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .accessibilityIdentifier("candidates.taxonomyPicker.empty")
                } else {
                    List(results) { reference in
                        Button {
                            onSelect(reference)
                        } label: {
                            Text(displayName(reference))
                        }
                        .accessibilityIdentifier("candidates.taxonomyPicker.result.\(reference.id)")
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle(title)
            .task { await runSearch() }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(closeTitle, action: onClose)
                        .accessibilityIdentifier("candidates.taxonomyPicker.close")
                }
            }
        }
    }

    private func runSearch() async {
        isSearching = true
        defer { isSearching = false }
        results = await search(query)
    }
}
