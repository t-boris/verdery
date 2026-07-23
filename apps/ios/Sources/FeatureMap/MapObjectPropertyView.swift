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

/// The property sheet: edits a selected object's label and — for every
/// category with a details schema (`structure`, `fence`, `gate`, `zone`,
/// `bed`, `tree`, `plant`, `utilityExclusion`, `annotation`) — its
/// category-specific details, plus delete/restore, duplicate, shape editing,
/// linework join, and a read-only measurement derived from its geometry.
///
/// `lot`, `path`, `waterFeature`, and `importedBackground` have no details
/// schema at all (`GardenObjectDetails`'s doc comment) — their details
/// section is deliberately empty, not a placeholder.
struct MapObjectPropertyView: View {
    let object: GardenMapObject
    let objectsById: [String: GardenMapObject]
    let strings: LocalizedStrings
    let assignablePlantTargets: [GardenMapObject]
    let supportsVertexEdit: Bool
    let canJoin: Bool
    let onSave: (String, GardenObjectDetails?) async -> Void
    let onDelete: () async -> Void
    let onRestore: () async -> Void
    let onDuplicate: () async -> Void
    let onAssignPlant: (String?) async -> Void
    let onEditShape: () -> Void
    let onBeginJoin: () -> Void
    let onClose: () -> Void

    @State private var label: String
    @State private var details: EditableDetailsState

    init(
        object: GardenMapObject,
        objectsById: [String: GardenMapObject],
        strings: LocalizedStrings,
        assignablePlantTargets: [GardenMapObject],
        supportsVertexEdit: Bool,
        canJoin: Bool,
        onSave: @escaping (String, GardenObjectDetails?) async -> Void,
        onDelete: @escaping () async -> Void,
        onRestore: @escaping () async -> Void,
        onDuplicate: @escaping () async -> Void,
        onAssignPlant: @escaping (String?) async -> Void,
        onEditShape: @escaping () -> Void,
        onBeginJoin: @escaping () -> Void,
        onClose: @escaping () -> Void
    ) {
        self.object = object
        self.objectsById = objectsById
        self.strings = strings
        self.assignablePlantTargets = assignablePlantTargets
        self.supportsVertexEdit = supportsVertexEdit
        self.canJoin = canJoin
        self.onSave = onSave
        self.onDelete = onDelete
        self.onRestore = onRestore
        self.onDuplicate = onDuplicate
        self.onAssignPlant = onAssignPlant
        self.onEditShape = onEditShape
        self.onBeginJoin = onBeginJoin
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

                if object.category == .plant {
                    assignedToSection
                }

                if let measurementText {
                    Section {
                        Text(measurementText).foregroundStyle(.secondary)
                    }
                }

                Section {
                    if supportsVertexEdit {
                        Button(strings(.mapPropertyEditShape), action: onEditShape)
                            .accessibilityIdentifier("map.property.editShape")
                    }
                    Button(strings(.mapPropertyDuplicate)) {
                        Task { await onDuplicate() }
                    }
                    .accessibilityIdentifier("map.property.duplicate")
                    if canJoin {
                        Button(strings(.mapLineworkJoinStart), action: onBeginJoin)
                            .accessibilityIdentifier("map.property.beginJoin")
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

    /// The plant-only "Assigned to" picker — a distinct command
    /// (`assignPlant`) from the label/details Save flow, so it submits on
    /// change rather than waiting for Save.
    private var assignedToSection: some View {
        Section(strings(.mapPlantAssignedToLabel)) {
            Picker(strings(.mapPlantAssignedToLabel), selection: assignedToBinding) {
                Text(strings(.mapPlantAssignedToNone)).tag(String?.none)
                ForEach(assignablePlantTargets) { target in
                    Text(target.label?.isEmpty == false ? target.label! : strings(.mapListUntitled))
                        .tag(String?.some(target.id))
                }
            }
            .labelsHidden()
            .accessibilityIdentifier("map.property.assignedTo")
        }
    }

    private var assignedToBinding: Binding<String?> {
        Binding(
            get: {
                if case let .plant(value)? = object.categoryDetails { return value.assignedToObjectId }
                return nil
            },
            set: { newValue in Task { await onAssignPlant(newValue) } }
        )
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

        case .gate:
            HStack {
                Text(strings(.mapGateFenceLabel))
                Spacer()
                Text(resolvedGateFenceLabel).foregroundStyle(.secondary)
            }
            TextField(strings(.mapGateWidthLabel), text: $details.gateWidthMetres)
                .decimalKeyboard()

        case .zone:
            Picker(strings(.mapZoneKindLabel), selection: $details.zoneKind) {
                ForEach(ZoneKind.allCases, id: \.self) { kind in
                    Text(MapCategoryLocalization.name(for: kind, strings: strings)).tag(kind)
                }
            }

        case .bed:
            Picker(strings(.mapBedKindLabel), selection: $details.bedKind) {
                ForEach(BedKind.allCases, id: \.self) { kind in
                    Text(MapCategoryLocalization.name(for: kind, strings: strings)).tag(kind)
                }
            }
            TextField(strings(.mapBedSoilNotesLabel), text: $details.bedSoilNotes)

        case .utilityExclusion:
            Picker(strings(.mapUtilityExclusionKindLabel), selection: $details.utilityExclusionKind) {
                ForEach(UtilityExclusionKind.allCases, id: \.self) { kind in
                    Text(MapCategoryLocalization.name(for: kind, strings: strings)).tag(kind)
                }
            }
            TextField(strings(.mapUtilityExclusionNotesLabel), text: $details.utilityExclusionNotes)

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

        case .annotation:
            TextField(strings(.mapAnnotationMeasurementValueLabel), text: $details.annotationMeasurementValue)
                .decimalKeyboard()
            Picker(strings(.mapAnnotationMeasurementUnitLabel), selection: $details.annotationMeasurementUnit) {
                ForEach(MeasurementUnit.allCases, id: \.self) { unit in
                    Text(MapCategoryLocalization.name(for: unit, strings: strings)).tag(unit)
                }
            }
            annotationMeasurementProvenance

        case .lot, .path, .waterFeature, .importedBackground:
            EmptyView()
        }
    }

    /// Read-only display of `uncertainty`/`acquisitionMethod`/`originalEntry`
    /// — fields the editable value/unit fields above never touch (see
    /// `EditableDetailsState.toDomain`'s doc comment on the `.annotation`
    /// case) but that must never be silently hidden once already present on
    /// the object. Reads directly from `object.categoryDetails`, not from
    /// `EditableDetailsState`, since these three fields are never part of
    /// what this form edits.
    @ViewBuilder
    private var annotationMeasurementProvenance: some View {
        if case let .annotation(value)? = object.categoryDetails, let measurement = value.measurement {
            VStack(alignment: .leading, spacing: 2) {
                Text(
                    strings.string(
                        .mapAnnotationAcquisitionMethodLabel,
                        parameters: ["method": MapCategoryLocalization.name(for: measurement.acquisitionMethod, strings: strings)]
                    )
                )
                if let uncertainty = measurement.uncertainty {
                    Text(
                        strings.string(
                            .mapAnnotationUncertaintyLabel,
                            parameters: [
                                "value": Self.formatted(uncertainty),
                                "unit": MapCategoryLocalization.name(for: measurement.unit, strings: strings),
                            ]
                        )
                    )
                }
                if let originalEntry = measurement.originalEntry {
                    Text(strings.string(.mapAnnotationOriginalEntryLabel, parameters: ["value": originalEntry]))
                }
            }
            .font(.footnote)
            .foregroundStyle(.secondary)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("map.property.annotationProvenance")
        }
    }

    /// The gate's fence, resolved to a display label when the fence object is
    /// still loaded locally, falling back to the raw id otherwise.
    /// Reassigning a gate to a different fence is out of scope — this is
    /// display-only, matching `EditableDetailsState.toDomain`'s handling of
    /// `fenceObjectId`, which always passes it through unchanged.
    private var resolvedGateFenceLabel: String {
        guard case let .gate(value)? = object.categoryDetails else { return "" }
        if let label = objectsById[value.fenceObjectId]?.label, !label.isEmpty {
            return label
        }
        return value.fenceObjectId
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
    var gateWidthMetres: String = ""
    var zoneKind: ZoneKind = .other
    var bedKind: BedKind = .inGround
    var bedSoilNotes: String = ""
    var utilityExclusionKind: UtilityExclusionKind = .other
    var utilityExclusionNotes: String = ""
    var treeCommonName: String = ""
    var treeHeightMetres: String = ""
    var treeSpreadMetres: String = ""
    var plantCommonName: String = ""
    var plantQuantity: String = "1"
    var plantSpacingMetres: String = ""
    var annotationMeasurementValue: String = ""
    var annotationMeasurementUnit: MeasurementUnit = .metres

    init(_ details: GardenObjectDetails?) {
        switch details {
        case let .structure(value):
            structureKind = value.structureKind
            structureHeightMetres = value.heightMetres.map(Self.format) ?? ""
        case let .fence(value):
            fenceKind = value.fenceKind
            fenceHeightMetres = value.heightMetres.map(Self.format) ?? ""
        case let .gate(value):
            gateWidthMetres = value.widthMetres.map(Self.format) ?? ""
        case let .zone(value):
            zoneKind = value.zoneKind
        case let .bed(value):
            bedKind = value.bedKind
            bedSoilNotes = value.soilNotes ?? ""
        case let .utilityExclusion(value):
            utilityExclusionKind = value.utilityExclusionKind
            utilityExclusionNotes = value.notes ?? ""
        case let .tree(value):
            treeCommonName = value.commonName ?? ""
            treeHeightMetres = value.estimatedHeightMetres.map(Self.format) ?? ""
            treeSpreadMetres = value.estimatedSpreadMetres.map(Self.format) ?? ""
        case let .plant(value):
            plantCommonName = value.commonName
            plantQuantity = String(value.quantity)
            plantSpacingMetres = value.spacingMetres.map(Self.format) ?? ""
        case let .annotation(value):
            if let measurement = value.measurement {
                annotationMeasurementValue = Self.format(measurement.value)
                annotationMeasurementUnit = measurement.unit
            }
        case .none:
            break
        }
    }

    private static func format(_ value: Double) -> String { String(value) }

    /// Builds the details payload Save submits. `lot`, `path`,
    /// `waterFeature`, and `importedBackground` have no details schema at
    /// all, so `existing` (always `nil` for them) passes straight through.
    func toDomain(category: GardenObjectCategory, existing: GardenObjectDetails?) -> GardenObjectDetails? {
        switch category {
        case .structure:
            return .structure(
                StructureDetails(structureKind: structureKind, heightMetres: Double(structureHeightMetres))
            )
        case .fence:
            return .fence(FenceDetails(fenceKind: fenceKind, heightMetres: Double(fenceHeightMetres)))
        case .gate:
            // `fenceObjectId` is display-only in this form (see
            // `MapObjectPropertyView`'s doc comment on `resolvedGateFenceLabel`)
            // — reassigning a gate to a different fence is out of scope, so
            // Save always carries the existing fence id through unchanged.
            var fenceObjectId = ""
            if case let .gate(value)? = existing { fenceObjectId = value.fenceObjectId }
            return .gate(GateDetails(fenceObjectId: fenceObjectId, widthMetres: Double(gateWidthMetres)))
        case .zone:
            return .zone(ZoneDetails(zoneKind: zoneKind))
        case .bed:
            return .bed(BedDetails(bedKind: bedKind, soilNotes: bedSoilNotes.isEmpty ? nil : bedSoilNotes))
        case .utilityExclusion:
            return .utilityExclusion(
                UtilityExclusionDetails(
                    utilityExclusionKind: utilityExclusionKind,
                    notes: utilityExclusionNotes.isEmpty ? nil : utilityExclusionNotes
                )
            )
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
        case .annotation:
            // The form only ever produces a fresh, user-entered measurement —
            // originalEntry/uncertainty/referenceObjectId/calibrationRevision
            // are left unset, matching the work package's own framing: those
            // fields belong to richer acquisition methods (AR, imported
            // plans) this simple value+unit form does not attempt.
            guard let value = Double(annotationMeasurementValue) else {
                return .annotation(AnnotationDetails(measurement: nil))
            }
            return .annotation(
                AnnotationDetails(
                    measurement: Measurement(value: value, unit: annotationMeasurementUnit, acquisitionMethod: .userEntered)
                )
            )
        case .lot, .path, .waterFeature, .importedBackground:
            return existing
        }
    }
}
