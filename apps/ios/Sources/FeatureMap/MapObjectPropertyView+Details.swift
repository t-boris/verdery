import CoreDesignSystem
import CoreDomain
import CoreLocalization
import SwiftUI

/// The per-category half of the object inspector: which fields a fence has
/// that a bed does not.
///
/// Split out of `MapObjectPropertyView.swift` when it crossed this
/// repository's 600-line ceiling. The seam is the one the screen already had —
/// the file above is the inspector's shape, this is what it contains for each
/// of thirteen categories.
extension MapObjectPropertyView {
    @ViewBuilder
    var detailsFields: some View {
        switch object.category {
        case .structure:
            MapKindChoice(
                name: strings(.mapStructureKindLabel),
                symbol: MapCategorySymbols.symbol(for: object.category),
                title: { MapCategoryLocalization.name(for: $0, strings: strings) },
                selection: $details.structureKind
            )
            MapDetailField(
                symbol: "ruler",
                name: strings(.mapStructureHeightLabel),
                text: $details.structureHeightMetres,
                isNumeric: true
            )

        case .fence:
            MapKindChoice(
                name: strings(.mapFenceKindLabel),
                symbol: MapCategorySymbols.symbol(for: object.category),
                title: { MapCategoryLocalization.name(for: $0, strings: strings) },
                selection: $details.fenceKind
            )
            MapDetailField(
                symbol: "ruler",
                name: strings(.mapFenceHeightLabel),
                text: $details.fenceHeightMetres,
                isNumeric: true
            )

        case .gate:
            HStack {
                Text(strings(.mapGateFenceLabel))
                Spacer()
                Text(resolvedGateFenceLabel).foregroundStyle(.secondary)
            }
            MapDetailField(
                symbol: "ruler",
                name: strings(.mapGateWidthLabel),
                text: $details.gateWidthMetres,
                isNumeric: true
            )

        case .zone:
            MapKindChoice(
                name: strings(.mapZoneKindLabel),
                symbol: MapCategorySymbols.symbol(for: object.category),
                title: { MapCategoryLocalization.name(for: $0, strings: strings) },
                selection: $details.zoneKind
            )

        case .bed:
            MapKindChoice(
                name: strings(.mapBedKindLabel),
                symbol: MapCategorySymbols.symbol(for: object.category),
                title: { MapCategoryLocalization.name(for: $0, strings: strings) },
                selection: $details.bedKind
            )
            MapDetailField(
                symbol: "text.alignleft",
                name: strings(.mapBedSoilNotesLabel),
                text: $details.bedSoilNotes
            )

        case .utilityExclusion:
            MapKindChoice(
                name: strings(.mapUtilityExclusionKindLabel),
                symbol: MapCategorySymbols.symbol(for: object.category),
                title: { MapCategoryLocalization.name(for: $0, strings: strings) },
                selection: $details.utilityExclusionKind
            )
            MapDetailField(
                symbol: "text.alignleft",
                name: strings(.mapUtilityExclusionNotesLabel),
                text: $details.utilityExclusionNotes
            )

        case .tree:
            MapDetailField(
                symbol: "text.alignleft",
                name: strings(.mapTreeCommonNameLabel),
                text: $details.treeCommonName
            )
            MapDetailField(
                symbol: "ruler",
                name: strings(.mapTreeHeightLabel),
                text: $details.treeHeightMetres,
                isNumeric: true
            )
            MapDetailField(
                symbol: "ruler",
                name: strings(.mapTreeSpreadLabel),
                text: $details.treeSpreadMetres,
                isNumeric: true
            )

        case .plant:
            MapDetailField(
                symbol: "text.alignleft",
                name: strings(.mapPlantCommonNameLabel),
                text: $details.plantCommonName
            )
            MapDetailField(
                symbol: "number",
                name: strings(.mapPlantQuantityLabel),
                text: $details.plantQuantity,
                isNumeric: true
            )
            MapDetailField(
                symbol: "ruler",
                name: strings(.mapPlantSpacingLabel),
                text: $details.plantSpacingMetres,
                isNumeric: true
            )

        case .annotation:
            MapDetailField(
                symbol: "ruler",
                name: strings(.mapAnnotationMeasurementValueLabel),
                text: $details.annotationMeasurementValue,
                isNumeric: true
            )
            MapKindChoice(
                name: strings(.mapAnnotationMeasurementUnitLabel),
                symbol: MapCategorySymbols.symbol(for: object.category),
                title: { MapCategoryLocalization.name(for: $0, strings: strings) },
                selection: $details.annotationMeasurementUnit
            )
            annotationMeasurementProvenance

        case .importedBackground:
            importedBackgroundStateRows

        case .lot, .path, .waterFeature:
            EmptyView()
        }
    }

    /// Read-only calibration state for a plan background — the same honest
    /// wording as the canvas badge and background panel
    /// (`MapCalibrationLabels`), plus the derived scale and transform
    /// revision when calibrated. Managed elsewhere (background panel,
    /// calibration flow); never edited by this form.
    @ViewBuilder
    var importedBackgroundStateRows: some View {
        if case let .importedBackground(value)? = object.categoryDetails {
            HStack {
                Text(strings(.mapBackgroundCalibrationStateLabel))
                Spacer()
                Text(MapCalibrationLabels.stateText(for: value.calibration, strings: strings))
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("map.property.calibrationState")
            }
            if let calibration = value.calibration {
                Text(
                    strings.string(
                        .mapCalibrationScaleSummary,
                        parameters: ["metres": strings.number(calibration.transform.metresPerPlanUnit, fractionDigits: 1)]
                    )
                        + " · "
                        + strings.string(
                            .mapCalibrationTransformRevision,
                            parameters: ["revision": String(calibration.transformRevision)]
                        )
                )
                .font(.footnote)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("map.property.calibrationSummary")
            }
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
    var annotationMeasurementProvenance: some View {
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
                                "value": formatted(uncertainty),
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
    var resolvedGateFenceLabel: String {
        guard case let .gate(value)? = object.categoryDetails else { return "" }
        if let label = objectsById[value.fenceObjectId]?.label, !label.isEmpty {
            return label
        }
        return value.fenceObjectId
    }

    /// A real measurement overlay, computed from the object's actual stored
    /// geometry via the same `GeometryMeasurement` functions validation
    /// uses — not a placeholder value.
    var measurementText: String? {
        switch object.geometry {
        case let .polygon(rings):
            guard let exterior = rings.first else { return nil }
            return strings.string(
                .mapPropertyMeasurementArea,
                parameters: ["squareMetres": formatted(GeometryMeasurement.ringArea(exterior))]
            )
        case let .lineString(line):
            return strings.string(
                .mapPropertyMeasurementLength,
                parameters: ["metres": formatted(GeometryMeasurement.lineLength(line))]
            )
        case .point, .multiLineString, .multiPolygon:
            return nil
        }
    }

    /// Two fraction digits, in the reader's locale.
    ///
    /// An instance method rather than a static one because the reader's
    /// locale lives on `strings`: `String(format: "%.2f", …)` produced a
    /// POSIX point regardless of language, so a Russian reader saw an area of
    /// `12.50` where every other number on the screen used a comma.
    func formatted(_ value: Double) -> String {
        strings.number(value, fractionDigits: 2)
    }
}
