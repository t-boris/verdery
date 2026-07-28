import CoreDomain
import SwiftUI

/// Sheet for choosing a `gardenAreaMapObjectId`/`placementMapObjectId` from
/// this garden's own active map objects, replacing a raw pasted UUID.
/// Mirrors `FeatureMap.MapGateFencePickerView`'s own shape (data and
/// closures only, no direct binding into the parent screen's `@Observable`
/// model) — the same picker convention this codebase already establishes,
/// reimplemented here rather than imported: `FeaturePlants` cannot depend on
/// `FeatureMap` (`DependencyRuleTests.featuresDoNotDependOnEachOther`).
///
/// No category filter: the backend itself places none on either field (see
/// `ListGardenMapObjects`'s own doc comment), so the same full list is
/// offered regardless of which field this sheet is choosing for.
struct MapObjectPickerView: View {
    let title: String
    let clearTitle: String
    let closeTitle: String
    let emptyMessage: String
    let objects: [GardenMapObject]
    let onSelect: (String?) -> Void
    let onClose: () -> Void

    var body: some View {
        NavigationStack {
            Group {
                if objects.isEmpty {
                    Text(emptyMessage)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .accessibilityIdentifier("plants.mapObjectPicker.empty")
                } else {
                    List {
                        Button(clearTitle) {
                            onSelect(nil)
                        }
                        .accessibilityIdentifier("plants.mapObjectPicker.clear")

                        ForEach(objects) { object in
                            Button {
                                onSelect(object.id)
                            } label: {
                                VStack(alignment: .leading) {
                                    Text(object.label?.isEmpty == false ? object.label! : object.category.rawValue)
                                    Text(object.category.rawValue)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .accessibilityIdentifier("plants.mapObjectPicker.object.\(object.id)")
                        }
                    }
                }
            }
            .navigationTitle(title)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(closeTitle, action: onClose)
                        .accessibilityIdentifier("plants.mapObjectPicker.close")
                }
            }
        }
    }
}
