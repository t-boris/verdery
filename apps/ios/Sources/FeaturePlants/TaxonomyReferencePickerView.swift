import CoreDomain
import SwiftUI

/// Sheet presented from the "Add a plant" form's taxonomy field: searches
/// `SearchTaxonomyReferences` and lets the user pick one result, or leave the
/// plant unidentified. Mirrors `FeatureMap`'s `MapGateFencePickerView` and
/// `MapObjectPropertyView`'s own shape: data and closures only, no direct
/// binding into the parent screen's `@Observable` model — this codebase's
/// established sheet convention, not something this file invents.
struct TaxonomyReferencePickerView: View {
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
                        .accessibilityIdentifier("plants.taxonomyPicker.searchField")
                        .onSubmit { Task { await runSearch() } }

                    Button {
                        Task { await runSearch() }
                    } label: {
                        Image(systemName: "magnifyingglass")
                    }
                    .accessibilityLabel(searchLabel)
                    .accessibilityIdentifier("plants.taxonomyPicker.searchSubmit")
                }
                .padding()

                if isSearching {
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if results.isEmpty {
                    Text(emptyMessage)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .accessibilityIdentifier("plants.taxonomyPicker.empty")
                } else {
                    List(results) { reference in
                        Button {
                            onSelect(reference)
                        } label: {
                            Text(displayName(reference))
                        }
                        .accessibilityIdentifier("plants.taxonomyPicker.result.\(reference.id)")
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle(title)
            .task { await runSearch() }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(closeTitle, action: onClose)
                        .accessibilityIdentifier("plants.taxonomyPicker.close")
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
