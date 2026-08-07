import Foundation
import Testing

@testable import CoreDomain

/// What a reviewer starts out ready to accept.
///
/// Pre-selection is a claim about trustworthiness, and it is the place where a
/// reading can quietly become an accepted boundary nobody checked. Every rule
/// here exists to keep a wrong lot from arriving pre-ticked.
@Suite("Plat reading review")
struct PlatReadingReviewTests {
    /// 1000 sq ft ≈ 92.903 m².
    private func reading(
        closes: Bool = true,
        areaSquareMetres: Double = 92.903,
        statedAreaSquareFeet: Double? = 1000,
        objectCount: Int = 2,
        hasBoundary: Bool = true
    ) -> PlatReading {
        let boundary = hasBoundary
            ? PlatBoundary(
                geometry: .polygon([[
                    Position(x: 0, y: 0), Position(x: 10, y: 0),
                    Position(x: 10, y: 9.29), Position(x: 0, y: 9.29),
                    Position(x: 0, y: 0),
                ]]),
                closureErrorMetres: closes ? 0.02 : 4.7,
                closes: closes,
                areaSquareMetres: areaSquareMetres,
                recoveredBearing: nil
            )
            : nil

        return PlatReading(
            isPlat: true,
            address: "7612 Cascade Way, Gurnee, IL 60031",
            northRotationDegrees: 12,
            statedAreaSquareFeet: statedAreaSquareFeet,
            boundaryCalls: [
                PlatBoundaryCall(
                    callNumber: 1,
                    bearingText: "N 46°54'11\" E",
                    distanceFeet: 135.06,
                    sourceLabel: "MEASURED"
                )
            ],
            boundary: boundary,
            objects: (0..<objectCount).map {
                ProposedPlatObject(
                    id: "object-\($0)",
                    category: .structure,
                    label: "House",
                    geometry: .point(Position(x: 1, y: 1)),
                    confidence: 0.9,
                    areaSquareMetres: 90
                )
            },
            pageFitResidualMetres: 0.3
        )
    }

    /// Both conditions, not either. Closure alone can be satisfied by a
    /// boundary that is the right shape in the wrong place, and area alone by a
    /// shape that happens to enclose the right amount of ground.
    @Test("pre-selects the boundary only when it closes AND the area agrees")
    func boundaryPreSelection() {
        #expect(PlatReadingReview.isBoundaryPreSelected(reading()))
        #expect(!PlatReadingReview.isBoundaryPreSelected(reading(closes: false)))
        // Closes, but encloses half the stated ground: the reading is wrong
        // somewhere and must not arrive pre-ticked.
        #expect(!PlatReadingReview.isBoundaryPreSelected(reading(areaSquareMetres: 46)))
    }

    /// An absent check is not a passed one.
    @Test("does not treat a missing stated area as agreement")
    func missingStatedArea() {
        #expect(!PlatReadingReview.areaAgrees(reading(statedAreaSquareFeet: nil)))
        #expect(!PlatReadingReview.isBoundaryPreSelected(reading(statedAreaSquareFeet: nil)))
        #expect(!PlatReadingReview.areaAgrees(reading(statedAreaSquareFeet: 0)))
    }

    /// Fifteen percent, loose on purpose: a plat's stated area is often rounded
    /// and sometimes excludes an easement the boundary includes.
    @Test("tolerates a surveyor's rounding but not a misread boundary")
    func areaTolerance() {
        // 92.903 m² stated; 14% under is inside, 16% under is not.
        #expect(PlatReadingReview.areaAgrees(reading(areaSquareMetres: 92.903 * 0.86)))
        #expect(!PlatReadingReview.areaAgrees(reading(areaSquareMetres: 92.903 * 0.84)))
        #expect(PlatReadingReview.areaAgrees(reading(areaSquareMetres: 92.903 * 1.14)))
        #expect(!PlatReadingReview.areaAgrees(reading(areaSquareMetres: 92.903 * 1.16)))
    }

    /// The rule ADR-0018 states as behaviour: every object's position rides the
    /// same page fit as the boundary, so a boundary that cannot be trusted
    /// makes every object on the sheet untrustworthy in the same way.
    @Test("offers no objects at all when the traverse does not close")
    func objectsWithheldWhenBoundaryFails() {
        #expect(PlatReadingReview.objectsAreOffered(reading()))
        #expect(!PlatReadingReview.objectsAreOffered(reading(closes: false)))
        #expect(!PlatReadingReview.objectsAreOffered(reading(hasBoundary: false)))
        // A closing boundary with nothing else drawn is ordinary, not a
        // failure — there is simply nothing to offer.
        #expect(!PlatReadingReview.objectsAreOffered(reading(objectCount: 0)))
    }

    @Test("a page that is not a plat has no boundary to pre-select")
    func notAPlat() {
        let notAPlat = PlatReading(
            isPlat: false,
            address: nil,
            northRotationDegrees: nil,
            statedAreaSquareFeet: nil,
            boundaryCalls: [],
            boundary: nil,
            objects: [],
            pageFitResidualMetres: nil
        )
        #expect(!PlatReadingReview.isBoundaryPreSelected(notAPlat))
        #expect(!PlatReadingReview.objectsAreOffered(notAPlat))
    }

    /// A line whose direction was not legible still arrives, because a closed
    /// figure recovers a missing direction and nothing recovers a side that was
    /// never mentioned.
    @Test("keeps a call whose bearing could not be read, and says so")
    func missingBearingIsSurfaced() {
        let call = PlatBoundaryCall(
            callNumber: 4,
            bearingText: nil,
            distanceFeet: 78.66,
            sourceLabel: "CHORD"
        )
        #expect(call.isBearingMissing)
        #expect(call.distanceFeet == 78.66)
    }
}

/// What an aerial photograph appears to show.
@Suite("Aerial tracing")
struct AerialTracingTests {
    private func proposal(_ id: String, _ evidence: AerialEvidence) -> AerialTracingProposal {
        AerialTracingProposal(
            id: id,
            category: .structure,
            label: "Shed",
            geometry: .point(Position(x: 0, y: 0)),
            confidence: 0.8,
            evidence: evidence
        )
    }

    /// Accepting a hedge nobody photographed, because a box was already ticked,
    /// is how a garden acquires a fence that is not there.
    @Test("pre-selects only what was actually seen")
    func inferredIsOfferedButNotPreSelected() {
        let tracing = AerialTracing(
            source: "usgsNaip",
            disclaimer: "Imagery is a backdrop, never geometry.",
            proposals: [
                proposal("seen", .visible),
                proposal("guessed", .inferred),
            ]
        )
        #expect(tracing.preSelectedIds == ["seen"])
        // Both are still offered — an inferred shape is worth showing, it is
        // just not worth ticking on somebody's behalf.
        #expect(tracing.proposals.count == 2)
    }

    @Test("pre-selects nothing when nothing was seen")
    func nothingVisible() {
        let tracing = AerialTracing(
            source: "usgsNaip",
            disclaimer: "x",
            proposals: [proposal("a", .inferred)]
        )
        #expect(tracing.preSelectedIds.isEmpty)
    }
}
