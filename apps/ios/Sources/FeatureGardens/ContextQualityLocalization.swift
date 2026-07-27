import CoreDomain
import CoreLocalization

/// Display names and the fixed value vocabularies for the Context quality
/// screen (P9D-UX-01) — kept separate from the view model the same way
/// `TodayLocalization` is kept separate from `TodayViewModel`.
///
/// Mirrors `apps/web/features/garden-context/labels.ts` exactly, per this
/// package's own "mirror the INFORMATION content" instruction.
enum ContextQualityLocalization {
    /// Every `GardenContextKind` this screen renders a row for, in a stable
    /// display order — the same order `GARDEN_CONTEXT_KINDS` establishes on
    /// the web sibling. `GardenContextKind.allCases`' own declaration order
    /// already matches this, but the explicit list documents the ordering
    /// as a deliberate display decision rather than an accident of
    /// declaration order.
    static let orderedKinds: [GardenContextKind] = [
        .sunExposure,
        .soilType,
        .drainage,
        .irrigationMethod,
        .growingContext,
        .microclimate,
    ]

    static func kindLabel(_ kind: GardenContextKind, strings: LocalizedStrings) -> String {
        switch kind {
        case .sunExposure: strings(.contextQualityKindSunExposure)
        case .soilType: strings(.contextQualityKindSoilType)
        case .drainage: strings(.contextQualityKindDrainage)
        case .irrigationMethod: strings(.contextQualityKindIrrigationMethod)
        case .growingContext: strings(.contextQualityKindGrowingContext)
        case .microclimate: strings(.contextQualityKindMicroclimate)
        }
    }

    static func sourceLabel(_ source: GardenContextSource, strings: LocalizedStrings) -> String {
        switch source {
        case .userDeclared: strings(.contextQualitySourceUserDeclared)
        case .horticulturallyReviewedDefault: strings(.contextQualitySourceHorticulturallyReviewedDefault)
        case .imported: strings(.contextQualitySourceImported)
        }
    }

    /// One fixed-vocabulary option: the raw wire `value` this kind's `PUT`
    /// expects, and its localized display label.
    struct ValueOption {
        let value: String
        let label: String
    }

    /// The fixed vocabulary for the four enumerated kinds, each paired with
    /// its localized label — a picker rather than free text, so an invalid
    /// enum value cannot be entered in the first place. `soilType`/
    /// `microclimate` return `nil`: they are free text, the same latitude
    /// `BedDetails.soilNotes` already takes.
    ///
    /// Values match `services/api/.../domain/garden-context-fact.ts`'s
    /// `SUN_EXPOSURE_VALUES`/`DRAINAGE_VALUES`/`IRRIGATION_METHOD_VALUES`/
    /// `GROWING_CONTEXT_VALUES` exactly — this is the one place this client
    /// needs to agree with that server-side vocabulary.
    static func valueOptions(for kind: GardenContextKind, strings: LocalizedStrings) -> [ValueOption]? {
        switch kind {
        case .sunExposure:
            return [
                ValueOption(value: "full_sun", label: strings(.contextQualityEnumSunExposureFullSun)),
                ValueOption(value: "partial_sun", label: strings(.contextQualityEnumSunExposurePartialSun)),
                ValueOption(value: "partial_shade", label: strings(.contextQualityEnumSunExposurePartialShade)),
                ValueOption(value: "full_shade", label: strings(.contextQualityEnumSunExposureFullShade)),
            ]
        case .drainage:
            return [
                ValueOption(value: "well_drained", label: strings(.contextQualityEnumDrainageWellDrained)),
                ValueOption(value: "poor_drainage", label: strings(.contextQualityEnumDrainagePoorDrainage)),
                ValueOption(value: "waterlogged", label: strings(.contextQualityEnumDrainageWaterlogged)),
            ]
        case .irrigationMethod:
            return [
                ValueOption(value: "manual", label: strings(.contextQualityEnumIrrigationMethodManual)),
                ValueOption(value: "drip", label: strings(.contextQualityEnumIrrigationMethodDrip)),
                ValueOption(value: "sprinkler", label: strings(.contextQualityEnumIrrigationMethodSprinkler)),
                ValueOption(value: "none", label: strings(.contextQualityEnumIrrigationMethodNone)),
            ]
        case .growingContext:
            return [
                ValueOption(value: "open_ground", label: strings(.contextQualityEnumGrowingContextOpenGround)),
                ValueOption(value: "container", label: strings(.contextQualityEnumGrowingContextContainer)),
                ValueOption(value: "greenhouse", label: strings(.contextQualityEnumGrowingContextGreenhouse)),
            ]
        case .soilType, .microclimate:
            return nil
        }
    }

    /// The label for one declared value, when `kind` has a fixed vocabulary
    /// and the value is a recognized member of it — `nil` for free text or
    /// an unrecognized value, so the caller falls back to the raw string
    /// rather than a missing translation.
    static func valueLabel(for kind: GardenContextKind, value: String, strings: LocalizedStrings) -> String? {
        valueOptions(for: kind, strings: strings)?.first { $0.value == value }?.label
    }
}
