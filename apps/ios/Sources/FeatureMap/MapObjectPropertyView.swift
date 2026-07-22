import CoreDomain
import CoreLocalization
import SwiftUI

/// A numeric-friendly software keyboard on iOS. `UIKeyboardType` — and the
/// `keyboardType(_:)` modifier itself — does not exist on macOS, which this
/// package also builds for headlessly (see `Package.swift`'s doc comment on
/// why `swift build`/`swift test` target macOS at all); the `#else` branch
/// is dead in the shipped iOS app but is what keeps that headless build
/// compiling, the same pattern `CoreAuthentication/FirebaseAuthenticationGateway.swift`
/// already uses for its own iOS/macOS split.
extension View {
    fileprivate func decimalKeyboard() -> some View {
        #if os(iOS)
        return self.keyboardType(.decimalPad)
        #else
        return self
        #endif
    }

    fileprivate func integerKeyboard() -> some View {
        #if os(iOS)
        return self.keyboardType(.numberPad)
        #else
        return self
        #endif
    }
}

/// The property sheet: edits a selected object's label and — for the
/// categories this pass has a form for (`structure`, `fence`, `tree`,
/// `plant`) — its category-specific details, plus delete/restore and a
/// read-only measurement derived from its geometry.
///
/// Categories with details this pass has no form for (`gate`, `zone`, `bed`,
/// `utilityExclusion`, `annotation`) show an explicit "not implemented yet"
/// note instead of a fake control, and Save leaves their existing details
/// untouched — see ``EditableDetailsState/toDomain(category:existing:)``.
struct MapObjectPropertyView: View {
    let object: GardenMapObject
    let strings: LocalizedStrings
    let onSave: (String, GardenObjectDetails?) async -> Void
    let onDelete: () async -> Void
    let onRestore: () async -> Void
    let onClose: () -> Void

    @State private var label: String
    @State private var details: EditableDetailsState

    init(
        object: GardenMapObject,
        strings: LocalizedStrings,
        onSave: @escaping (String, GardenObjectDetails?) async -> Void,
        onDelete: @escaping () async -> Void,
        onRestore: @escaping () async -> Void,
        onClose: @escaping () -> Void
    ) {
        self.object = object
        self.strings = strings
        self.onSave = onSave
        self.onDelete = onDelete
        self.onRestore = onRestore
        self.onClose = onClose
        _label = State(initialValue: object.label ?? "")
        _details = State(initialValue: EditableDetailsState(object.categoryDetails))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField(strings(.mapPropertyLabelField), text: $label)
                        .accessibilityIdentifier("map.property.labelField")
                }

                Section(strings(.mapPropertyDetailsTitle)) {
                    detailsFields
                }

                if let measurementText {
                    Section {
                        Text(measurementText).foregroundStyle(.secondary)
                    }
                }

                Section {
                    if object.lifecycleState == .deleted {
                        Button(strings(.mapPropertyRestore)) {
                            Task { await onRestore() }
                        }
                        .accessibilityIdentifier("map.property.restore")
                    } else {
                        Button(strings(.mapPropertyDelete), role: .destructive) {
                            Task { await onDelete() }
                        }
                        .accessibilityIdentifier("map.property.delete")
                    }
                }
            }
            .navigationTitle(strings(.mapPropertyTitle))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(strings(.mapPropertyClose), action: onClose)
                        .accessibilityIdentifier("map.property.close")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(strings(.mapPropertySave)) {
                        Task { await onSave(label, details.toDomain(category: object.category, existing: object.categoryDetails)) }
                    }
                    .accessibilityIdentifier("map.property.save")
                }
            }
        }
    }

    @ViewBuilder
    private var detailsFields: some View {
        switch object.category {
        case .structure:
            Picker(strings(.mapStructureKindLabel), selection: $details.structureKind) {
                ForEach(StructureKind.allCases, id: \.self) { kind in
                    Text(MapCategoryLocalization.name(for: kind, strings: strings)).tag(kind)
                }
            }
            TextField(strings(.mapStructureHeightLabel), text: $details.structureHeightMetres)
                .decimalKeyboard()

        case .fence:
            Picker(strings(.mapFenceKindLabel), selection: $details.fenceKind) {
                ForEach(FenceKind.allCases, id: \.self) { kind in
                    Text(MapCategoryLocalization.name(for: kind, strings: strings)).tag(kind)
                }
            }
            TextField(strings(.mapFenceHeightLabel), text: $details.fenceHeightMetres)
                .decimalKeyboard()

        case .tree:
            TextField(strings(.mapTreeCommonNameLabel), text: $details.treeCommonName)
            TextField(strings(.mapTreeHeightLabel), text: $details.treeHeightMetres)
                .decimalKeyboard()
            TextField(strings(.mapTreeSpreadLabel), text: $details.treeSpreadMetres)
                .decimalKeyboard()

        case .plant:
            TextField(strings(.mapPlantCommonNameLabel), text: $details.plantCommonName)
            TextField(strings(.mapPlantQuantityLabel), text: $details.plantQuantity)
                .integerKeyboard()
            TextField(strings(.mapPlantSpacingLabel), text: $details.plantSpacingMetres)
                .decimalKeyboard()

        case .lot, .path, .waterFeature, .importedBackground:
            EmptyView()

        case .gate, .zone, .bed, .utilityExclusion, .annotation:
            // TODO(P3-IOS-01): editable forms for these five once each has a
            // designed property layout — see this file's doc comment.
            Text(strings(.mapPropertyDetailsUnavailable))
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("map.property.detailsUnavailable")
        }
    }

    /// A real measurement overlay, computed from the object's actual stored
    /// geometry via the same `GeometryMeasurement` functions validation
    /// uses — not a placeholder value.
    private var measurementText: String? {
        switch object.geometry {
        case let .polygon(rings):
            guard let exterior = rings.first else { return nil }
            return strings.string(
                .mapPropertyMeasurementArea,
                parameters: ["squareMetres": Self.formatted(GeometryMeasurement.ringArea(exterior))]
            )
        case let .lineString(line):
            return strings.string(
                .mapPropertyMeasurementLength,
                parameters: ["metres": Self.formatted(GeometryMeasurement.lineLength(line))]
            )
        case .point, .multiLineString, .multiPolygon:
            return nil
        }
    }

    private static func formatted(_ value: Double) -> String {
        String(format: "%.2f", value)
    }
}

/// Local, per-field editing state for the category-detail forms above.
///
/// One flat struct rather than one type per category: at most one group of
/// fields is ever visible at once (`object.category` never changes within
/// one sheet's lifetime), so the simplicity of a single `@State` value
/// outweighs the unused fields for any given category.
struct EditableDetailsState: Equatable {
    var structureKind: StructureKind = .other
    var structureHeightMetres: String = ""
    var fenceKind: FenceKind = .other
    var fenceHeightMetres: String = ""
    var treeCommonName: String = ""
    var treeHeightMetres: String = ""
    var treeSpreadMetres: String = ""
    var plantCommonName: String = ""
    var plantQuantity: String = "1"
    var plantSpacingMetres: String = ""

    init(_ details: GardenObjectDetails?) {
        switch details {
        case let .structure(value):
            structureKind = value.structureKind
            structureHeightMetres = value.heightMetres.map(Self.format) ?? ""
        case let .fence(value):
            fenceKind = value.fenceKind
            fenceHeightMetres = value.heightMetres.map(Self.format) ?? ""
        case let .tree(value):
            treeCommonName = value.commonName ?? ""
            treeHeightMetres = value.estimatedHeightMetres.map(Self.format) ?? ""
            treeSpreadMetres = value.estimatedSpreadMetres.map(Self.format) ?? ""
        case let .plant(value):
            plantCommonName = value.commonName
            plantQuantity = String(value.quantity)
            plantSpacingMetres = value.spacingMetres.map(Self.format) ?? ""
        case .gate, .zone, .bed, .utilityExclusion, .annotation, .none:
            break
        }
    }

    private static func format(_ value: Double) -> String { String(value) }

    /// Builds the details payload Save submits. Categories this pass has no
    /// form for pass `existing` straight through unchanged, rather than
    /// dropping fields this view never showed the user.
    func toDomain(category: GardenObjectCategory, existing: GardenObjectDetails?) -> GardenObjectDetails? {
        switch category {
        case .structure:
            return .structure(
                StructureDetails(structureKind: structureKind, heightMetres: Double(structureHeightMetres))
            )
        case .fence:
            return .fence(FenceDetails(fenceKind: fenceKind, heightMetres: Double(fenceHeightMetres)))
        case .tree:
            var canopyGeometry: Geometry?
            if case let .tree(value)? = existing { canopyGeometry = value.canopyGeometry }
            return .tree(
                TreeDetails(
                    canopyGeometry: canopyGeometry,
                    commonName: treeCommonName.isEmpty ? nil : treeCommonName,
                    estimatedHeightMetres: Double(treeHeightMetres),
                    estimatedSpreadMetres: Double(treeSpreadMetres)
                )
            )
        case .plant:
            var assignedToObjectId: String?
            if case let .plant(value)? = existing { assignedToObjectId = value.assignedToObjectId }
            return .plant(
                PlantPlacementDetails(
                    commonName: plantCommonName,
                    quantity: Int(plantQuantity) ?? 1,
                    spacingMetres: Double(plantSpacingMetres),
                    assignedToObjectId: assignedToObjectId
                )
            )
        case .lot, .path, .waterFeature, .importedBackground, .gate, .zone, .bed, .utilityExclusion, .annotation:
            return existing
        }
    }
}
