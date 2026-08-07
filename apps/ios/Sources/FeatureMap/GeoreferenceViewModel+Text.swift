import CoreDomain
import CoreLocalization
import Foundation

/// The georeference screen's own wording — split from the view model itself so
/// neither file approaches this repository's 600-line rule, the same way
/// `PlantDetailView+Editing.swift` and its siblings already split.
extension GeoreferenceViewModel {
    public var title: String { strings(.georeferenceTitle) }
    public var explanation: String { strings(.georeferenceExplanation) }
    public var notSetText: String { strings(.georeferenceNotSet) }
    public var useMyLocationTitle: String { strings(.georeferenceUseMyLocation) }
    public var locatingText: String { strings(.georeferenceLocating) }
    public var locationDeniedText: String { strings(.georeferenceLocationDenied) }
    public var searchLabel: String { strings(.georeferenceSearchAddress) }
    public var searchHint: String { strings(.georeferenceSearchHint) }
    public var noCandidatesText: String { strings(.georeferenceNoCandidates) }
    public var providerUnavailableText: String { strings(.georeferenceProviderUnavailable) }
    public var dropPinTitle: String { strings(.georeferenceDropPin) }
    public var dropPinHint: String { strings(.georeferenceDropPinHint) }
    public var useThisPointTitle: String { strings(.georeferenceUseThisPoint) }
    public var northLabel: String { strings(.georeferenceNorth) }
    public var northHint: String { strings(.georeferenceNorthHint) }
    public var useDeviceHeadingTitle: String { strings(.georeferenceUseDeviceHeading) }
    public var headingProposedText: String { strings(.georeferenceHeadingProposed) }
    public var anchorLabel: String { strings(.georeferenceAnchor) }
    public var accuracyLabel: String { strings(.georeferenceAccuracy) }
    public var accuracyUnknownText: String { strings(.georeferenceAccuracyUnknown) }
    public var saveTitle: String { strings(.georeferenceSave) }
    public var replaceWarning: String { strings(.georeferenceReplaceWarning) }
    public var closeTitle: String { strings(.plantsClose) }

    /// Only when there is something to replace. A warning about overwriting
    /// nothing is noise, and noise is how real warnings stop being read.
    public var showsReplaceWarning: Bool { existing != nil }

    public func precisionName(_ precision: AddressPrecision) -> String {
        switch precision {
        case .streetAddress: strings(.georeferencePrecisionStreetAddress)
        case .street: strings(.georeferencePrecisionStreet)
        case .area: strings(.georeferencePrecisionArea)
        }
    }

    /// Latitude first, the way coordinates are read aloud, even though the
    /// `Position` carries longitude in `x` — the contract's own order.
    public var anchorText: String? {
        guard let anchor = draft.geographicAnchor else { return nil }
        return strings.string(
            .georeferenceAnchorValue,
            parameters: [
                "latitude": strings.number(anchor.y, fractionDigits: 5),
                "longitude": strings.number(anchor.x, fractionDigits: 5),
            ]
        )
    }

    /// Absent means "not expressed", never "exact", and the two are said
    /// differently: a pin claims no accuracy, and inventing one for it would be
    /// a claim nobody made.
    public var accuracyText: String {
        guard let accuracy = draft.accuracyMetres else {
            return strings(.georeferenceAccuracyUnknown)
        }
        return strings.string(
            .georeferenceAccuracyValue,
            parameters: ["metres": strings.number(accuracy, fractionDigits: 0)]
        )
    }

    public var rotationText: String {
        strings.string(
            .georeferenceNorthValue,
            parameters: [
                "degrees": strings.number(draft.normalizedRotationDegrees, fractionDigits: 0)
            ]
        )
    }

    public var canSave: Bool { draft.canSubmit && !isSaving }
}
