import Foundation

/// One line of a plat's boundary description, as printed.
public struct PlatBoundaryCall: Sendable, Equatable, Identifiable {
    /// Numbered from 1, the way a person reads them off the sheet.
    public let callNumber: Int
    /// The bearing rendered as the plat prints it — `N 46°54'11" E` — or `nil`
    /// when this line's direction was not legible. The line is still carried:
    /// a closed figure recovers a missing direction from the other sides, and
    /// nothing recovers a side that was never mentioned.
    public let bearingText: String?
    /// Along the line, in feet, as printed. Never converted by the reader, so
    /// a reviewer comparing this against the drawing is comparing the same
    /// number in the same unit.
    public let distanceFeet: Double
    /// What the sheet labelled this line — `RECORD`, `MEASURED`. Two labels for
    /// one side is ordinary on a plat and worth showing.
    public let sourceLabel: String

    public init(
        callNumber: Int,
        bearingText: String?,
        distanceFeet: Double,
        sourceLabel: String
    ) {
        self.callNumber = callNumber
        self.bearingText = bearingText
        self.distanceFeet = distanceFeet
        self.sourceLabel = sourceLabel
    }

    public var id: Int { callNumber }

    /// This line's direction has to be recovered from the figure. Surfaced,
    /// because a reviewer is entitled to know which side was inferred.
    public var isBearingMissing: Bool { bearingText == nil }
}

/// A direction that was recovered from the figure rather than read off the page.
///
/// A plat is a closed figure, so any n−1 correct calls determine the last side
/// exactly. When a reading transcribes every distance but loses one bearing —
/// a curved road frontage, whose direction is printed as a chord bearing among
/// radius and arc figures, is where this happens — the figure supplies the
/// missing direction, and the distance printed for that same line is the
/// independent check on it.
///
/// Never more than one line, and never a length. It is surfaced rather than
/// hidden because a reviewer is entitled to know which side of their boundary
/// was inferred.
public struct RecoveredBearing: Sendable, Equatable {
    public let callNumber: Int
    /// How far the closing line's own length is from the distance printed for
    /// it. Near zero means the survey and the reading agree about that side's
    /// length, and only its direction had been misread.
    public let lengthDisagreementMetres: Double

    public init(callNumber: Int, lengthDisagreementMetres: Double) {
        self.callNumber = callNumber
        self.lengthDisagreementMetres = lengthDisagreementMetres
    }
}

/// The polygon the calls describe, with the survey's own check on it.
public struct PlatBoundary: Sendable, Equatable {
    /// Garden-local metres, first corner at the origin.
    public let geometry: Geometry
    /// How far the walk landed from where it started. A misread bearing shows
    /// up here as a gap in metres rather than as a plausible wrong shape,
    /// which is the whole reason a traverse is walked instead of trusted.
    public let closureErrorMetres: Double
    /// `false` when the gap is larger than this product will call a boundary.
    public let closes: Bool
    public let areaSquareMetres: Double
    public let recoveredBearing: RecoveredBearing?

    public init(
        geometry: Geometry,
        closureErrorMetres: Double,
        closes: Bool,
        areaSquareMetres: Double,
        recoveredBearing: RecoveredBearing?
    ) {
        self.geometry = geometry
        self.closureErrorMetres = closureErrorMetres
        self.closes = closes
        self.areaSquareMetres = areaSquareMetres
        self.recoveredBearing = recoveredBearing
    }
}

/// Something else the sheet draws — a house, a deck, a driveway.
public struct ProposedPlatObject: Sendable, Equatable, Identifiable {
    public let category: GardenObjectCategory
    /// What the drawing calls it verbatim, or empty for clear unlabelled
    /// linework.
    public let label: String
    public let geometry: Geometry
    /// The reader's own confidence in having seen this. Shown at review;
    /// decides nothing — the person decides.
    public let confidence: Double
    public let areaSquareMetres: Double
    /// Client-minted, because the contract gives these no identity of their
    /// own: they are proposals, and a proposal that is never accepted never
    /// needs one that outlives the screen.
    public let id: String

    public init(
        id: String,
        category: GardenObjectCategory,
        label: String,
        geometry: Geometry,
        confidence: Double,
        areaSquareMetres: Double
    ) {
        self.id = id
        self.category = category
        self.label = label
        self.geometry = geometry
        self.confidence = confidence
        self.areaSquareMetres = areaSquareMetres
    }
}

/// What a plat of survey says, and the boundary its calls describe.
///
/// **A reading, never a write.** Nothing here has touched the garden: accepting
/// any of it is a separate, ordinary act — a georeference for the location and
/// north, map commands for the shapes — each carrying its own authorization,
/// revision and audit trail. That separation is ADR-0018's whole point.
public struct PlatReading: Sendable, Equatable {
    /// `false` when the page is not a plat at all — a real answer, not an error.
    public let isPlat: Bool
    public let address: String?
    /// Degrees the north arrow points clockwise from the top of the page.
    public let northRotationDegrees: Double?
    /// The area the sheet itself states: a reviewer's independent check on the
    /// walk, and the reason the two numbers are shown side by side.
    public let statedAreaSquareFeet: Double?
    public let boundaryCalls: [PlatBoundaryCall]
    public let boundary: PlatBoundary?
    /// Empty when the lot could not be fitted. An object placed by a guess at
    /// scale would be worse than no object.
    public let objects: [ProposedPlatObject]
    /// How closely the drawing's own outline matched the surveyed polygon.
    /// Every proposed object rides that fit, so this is the honest bound on all
    /// of them.
    public let pageFitResidualMetres: Double?

    public init(
        isPlat: Bool,
        address: String?,
        northRotationDegrees: Double?,
        statedAreaSquareFeet: Double?,
        boundaryCalls: [PlatBoundaryCall],
        boundary: PlatBoundary?,
        objects: [ProposedPlatObject],
        pageFitResidualMetres: Double?
    ) {
        self.isPlat = isPlat
        self.address = address
        self.northRotationDegrees = northRotationDegrees
        self.statedAreaSquareFeet = statedAreaSquareFeet
        self.boundaryCalls = boundaryCalls
        self.boundary = boundary
        self.objects = objects
        self.pageFitResidualMetres = pageFitResidualMetres
    }
}

/// Which parts of a reading a reviewer starts out ready to accept.
///
/// Pre-selection is a claim about trustworthiness, so it is arithmetic rather
/// than optimism, and it is tested as arithmetic.
public enum PlatReadingReview {
    /// The area agreement this product treats as corroboration.
    ///
    /// Fifteen percent is loose by survey standards and deliberately so: the
    /// stated area on a plat is often rounded to the nearest ten square feet
    /// and sometimes excludes an easement the boundary includes. It is a check
    /// against a *misread* boundary, not against a surveyor's rounding.
    public static let areaAgreementTolerance = 0.15

    private static let squareMetresPerSquareFoot = 0.092_903

    /// Whether the walked area corroborates the sheet's own stated area.
    ///
    /// `false` when either number is missing: an absent check is not a passed
    /// one.
    public static func areaAgrees(_ reading: PlatReading) -> Bool {
        guard
            let boundary = reading.boundary,
            let statedSquareFeet = reading.statedAreaSquareFeet,
            statedSquareFeet > 0
        else {
            return false
        }
        let statedSquareMetres = statedSquareFeet * squareMetresPerSquareFoot
        let difference = abs(boundary.areaSquareMetres - statedSquareMetres)
        return difference / statedSquareMetres <= areaAgreementTolerance
    }

    /// Whether the boundary is pre-checked for the reviewer.
    ///
    /// Both conditions, not either: the traverse must close **and** the walked
    /// area must agree with the printed one. Closure alone can be satisfied by
    /// a boundary that is the right shape in the wrong place, and area alone by
    /// a shape that happens to enclose the right amount of ground.
    public static func isBoundaryPreSelected(_ reading: PlatReading) -> Bool {
        guard let boundary = reading.boundary, boundary.closes else { return false }
        return areaAgrees(reading)
    }

    /// Whether any object is offered at all.
    ///
    /// **Nothing is proposed when the traverse does not close.** Every object's
    /// position rides the same page fit as the boundary, so a boundary that
    /// cannot be trusted makes every object on the sheet untrustworthy in
    /// exactly the same way — and a deck placed confidently inside a wrong lot
    /// is worse than no deck.
    public static func objectsAreOffered(_ reading: PlatReading) -> Bool {
        guard let boundary = reading.boundary, boundary.closes else { return false }
        return !reading.objects.isEmpty
    }
}
