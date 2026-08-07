import CoreDesignSystem
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
/// `lot`, `path`, and `waterFeature` have no details schema at all
/// (`GardenObjectDetails`'s doc comment) — their details section is
/// deliberately empty, not a placeholder. `importedBackground` shows its
/// calibration state READ-ONLY here; its editable details (visibility) and
/// the calibration flow live in the background panel and calibration bar.
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

    @State var label: String
    @State var details: EditableDetailsState

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
            ScrollView {
                VStack(alignment: .leading, spacing: Metrics.space4) {
                    ComposerField(
                        symbol: MapCategorySymbols.symbol(for: object.category),
                        accessibilityName: strings(.mapPropertyLabelField),
                        placeholder: strings(.mapPropertyLabelField),
                        commitLabel: strings(.mapPropertySave),
                        text: $label,
                        commit: save
                    )
                    .accessibilityIdentifier("map.property.labelField")

                    if let measurementText {
                        // A measured value, in the face measured values use.
                        SurfaceCard {
                            Text(measurementText)
                                .font(FieldConsoleType.mono.font)
                                .foregroundStyle(Palette.textMuted)
                        }
                    }

                    VStack(alignment: .leading, spacing: Metrics.space3) {
                        SectionEyebrow(
                            symbol: "slider.horizontal.3",
                            title: strings(.mapPropertyDetailsTitle)
                        )
                        detailsFields
                    }

                    if object.category == .plant {
                        assignedToSection
                    }

                    // Shape, duplicate and join are things done TO the object,
                    // so they read as a row of icon actions rather than as
                    // three more rows in a settings stack.
                    FlowRow(spacing: Metrics.space3) {
                        if supportsVertexEdit {
                            CompactActionButton(
                                symbol: "pencil.and.outline",
                                title: strings(.mapPropertyEditShape),
                                action: onEditShape
                            )
                            .accessibilityIdentifier("map.property.editShape")
                        }
                        CompactActionButton(
                            symbol: "plus.square.on.square",
                            title: strings(.mapPropertyDuplicate)
                        ) {
                            Task { await onDuplicate() }
                        }
                        .accessibilityIdentifier("map.property.duplicate")
                        if canJoin {
                            CompactActionButton(
                                symbol: "arrow.trianglehead.merge",
                                title: strings(.mapLineworkJoinStart),
                                action: onBeginJoin
                            )
                            .accessibilityIdentifier("map.property.beginJoin")
                        }
                    }

                    // Destructive last, on its own, the way every record card
                    // in this application ends.
                    if object.lifecycleState == .deleted {
                        Button(strings(.mapPropertyRestore)) {
                            Task { await onRestore() }
                        }
                        .buttonStyle(SecondaryButtonStyle())
                        .accessibilityIdentifier("map.property.restore")
                    } else {
                        Button(strings(.mapPropertyDelete)) {
                            Task { await onDelete() }
                        }
                        .buttonStyle(SecondaryButtonStyle(tone: .negative))
                        .accessibilityIdentifier("map.property.delete")
                    }
                }
                .padding(Metrics.space4)
            }
            .screenBackground()
            .navigationTitle(strings(.mapPropertyTitle))
            .inlineNavigationTitle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(strings(.mapPropertyClose), action: onClose)
                        .accessibilityIdentifier("map.property.close")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(strings(.mapPropertySave), action: save)
                        .accessibilityIdentifier("map.property.save")
                }
            }
        }
    }

    private func save() {
        Task {
            await onSave(
                label,
                details.toDomain(category: object.category, existing: object.categoryDetails)
            )
        }
    }

    /// The plant-only "Assigned to" picker — a distinct command
    /// (`assignPlant`) from the label/details Save flow, so it submits on
    /// change rather than waiting for Save.
    private var assignedToSection: some View {
        Section(strings(.mapPlantAssignedToLabel)) {
            ChoiceChipGrid(
                fieldName: strings(.mapPlantAssignedToLabel),
                options: [ChoiceChipGrid.Option(
                    value: String?.none,
                    label: strings(.mapPlantAssignedToNone),
                    symbol: "circle"
                )] + assignablePlantTargets.map { target in
                    ChoiceChipGrid.Option(
                        value: String?.some(target.id),
                        label: target.label?.isEmpty == false
                            ? target.label! : strings(.mapListUntitled),
                        symbol: "leaf"
                    )
                },
                selection: assignedToBinding
            )
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
        case .importedBackground, .none:
            // An imported background's details are managed from the
            // background panel (visibility) and the calibration flow
            // (state/transform) — this form edits none of them.
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
        case .importedBackground:
            // Save passes the current details through with the server-owned
            // calibration block stripped (`writableDetails`) — the server
            // would ignore an echoed block anyway, but never submitting one
            // keeps the client honest about what it owns.
            if case let .importedBackground(value)? = existing {
                return .importedBackground(value.writableDetails)
            }
            return existing
        case .lot, .path, .waterFeature:
            return existing
        }
    }
}
