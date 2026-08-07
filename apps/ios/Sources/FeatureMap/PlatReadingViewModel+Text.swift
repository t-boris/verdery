import CoreDomain
import CoreLocalization
import Foundation

/// The plat review screen's own wording — split from the view model so neither
/// file approaches this repository's 600-line rule.
extension PlatReadingViewModel {
    public var title: String { strings(.platTitle) }
    public var explanation: String { strings(.platExplanation) }
    public var readingMessage: String { strings(.platReading) }
    public var notAPlatMessage: String { strings(.platNotAPlat) }
    public var addressLabel: String { strings(.platAddress) }
    public var northLabel: String { strings(.platNorth) }
    public var statedAreaLabel: String { strings(.platStatedArea) }
    public var walkedAreaLabel: String { strings(.platWalkedArea) }
    public var closureLabel: String { strings(.platClosure) }
    public var closesTitle: String { strings(.platClosesTitle) }
    public var doesNotCloseTitle: String { strings(.platDoesNotCloseTitle) }
    public var doesNotCloseMessage: String { strings(.platDoesNotCloseMessage) }
    public var callsTitle: String { strings(.platCallsTitle) }
    public var objectsTitle: String { strings(.platObjectsTitle) }
    public var objectsWithheldMessage: String { strings(.platObjectsWithheld) }
    public var pageFitLabel: String { strings(.platPageFit) }
    public var acceptBoundaryTitle: String { strings(.platAcceptBoundary) }
    public var acceptLocationTitle: String { strings(.platAcceptLocation) }
    public var acceptObjectsTitle: String { strings(.platAcceptObjects) }
    public var nothingSelectedMessage: String { strings(.platNothingSelected) }
    public var closeTitle: String { strings(.mapPropertyClose) }

    /// The two areas, side by side, and a sentence about whether they agree.
    /// The sentence is the point: two numbers next to each other invite a
    /// reader to do arithmetic that this already did.
    public func areaAgreementText(_ reading: PlatReading) -> String {
        PlatReadingReview.areaAgrees(reading)
            ? strings(.platAreaAgrees)
            : strings(.platAreaDisagrees)
    }

    public func areaAgrees(_ reading: PlatReading) -> Bool {
        PlatReadingReview.areaAgrees(reading)
    }

    public func areaText(_ squareMetres: Double) -> String {
        strings.string(
            .platAreaValue,
            parameters: ["value": strings.number(squareMetres, fractionDigits: 1)]
        )
    }

    /// The sheet's own figure, converted so the two are comparable. Converted
    /// here rather than by the reader, and shown in the same unit as the walked
    /// area, because a reviewer asked to compare 1000 ft² against 92.9 m² is
    /// being asked to do the conversion in their head.
    public func statedAreaText(_ squareFeet: Double) -> String {
        areaText(squareFeet * 0.092_903)
    }

    public func closureText(_ metres: Double) -> String {
        strings.string(
            .platClosureValue,
            parameters: ["value": strings.number(metres, fractionDigits: 2)]
        )
    }

    public func northText(_ degrees: Double) -> String {
        strings.string(
            .platNorthValue,
            parameters: ["degrees": strings.number(degrees, fractionDigits: 0)]
        )
    }

    public func pageFitText(_ metres: Double) -> String {
        strings.string(
            .platPageFitValue,
            parameters: ["value": strings.number(metres, fractionDigits: 2)]
        )
    }

    /// One call as the sheet prints it, so a reviewer comparing this line
    /// against the drawing is comparing the same characters.
    public func callText(_ call: PlatBoundaryCall) -> String {
        strings.string(
            .platCallLine,
            parameters: [
                "bearing": call.bearingText ?? strings(.platCallBearingMissing),
                "distance": strings.number(call.distanceFeet, fractionDigits: 2),
                "source": call.sourceLabel,
            ]
        )
    }

    /// Which side had its direction inferred, and how far its printed length
    /// disagrees with the closing line's. A reviewer is entitled to both.
    public func recoveredBearingText(_ recovered: RecoveredBearing) -> String {
        strings.string(
            .platRecoveredBearing,
            parameters: [
                "number": String(recovered.callNumber),
                "metres": strings.number(recovered.lengthDisagreementMetres, fractionDigits: 2),
            ]
        )
    }

    public func objectLabel(_ object: ProposedPlatObject) -> String {
        object.label.isEmpty ? object.category.rawValue : object.label
    }
}
