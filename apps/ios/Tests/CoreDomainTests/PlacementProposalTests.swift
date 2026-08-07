import Foundation
import Testing

@testable import CoreDomain

/// Turning "here is where the phone is" into "here is the bed you are standing
/// in" — and, just as importantly, into silence when it does not know.
///
/// This proposal removes the worst step in adding a plant: picking a placement
/// out of a list of every object in the garden. It also has the most dangerous
/// failure mode in the capture flow, because a wrong answer arrives looking
/// exactly like a right one.
@Suite("Placement proposal")
struct PlacementProposalTests {
    /// A garden whose local origin sits at a real coordinate in Chicago, with
    /// local metres aligned to true north.
    private func georeference(
        rotationDegrees: Double = 0,
        scaleCorrection: Double = 1
    ) -> GardenGeoreference {
        GardenGeoreference(
            localAnchor: Position(x: 0, y: 0),
            geographicAnchor: Position(x: -87.6298, y: 41.8781),
            rotationDegrees: rotationDegrees,
            scaleCorrection: scaleCorrection,
            accuracyMetres: nil,
            provenance: .userMeasurement,
            method: "test",
            revision: 1
        )
    }

    private func area(
        id: String,
        category: GardenObjectCategory,
        from origin: Position,
        size: Double
    ) -> GardenMapObject {
        let ring = [
            origin,
            Position(x: origin.x + size, y: origin.y),
            Position(x: origin.x + size, y: origin.y + size),
            Position(x: origin.x, y: origin.y + size),
            origin,
        ]
        return GardenMapObject(
            id: id,
            gardenId: "garden-1",
            category: category,
            geometry: .polygon([ring]),
            coordinateSpaceId: "space-1",
            label: id,
            categoryDetails: nil,
            lifecycleState: .active,
            revision: 1,
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0)
        )
    }

    /// Roughly 11 metres north and 8 metres east of the anchor.
    private let insideLatitude = 41.87820
    private let insideLongitude = -87.62970

    @Test("names the area the coordinate falls inside")
    func proposesContainingArea() {
        let proposal = PlacementProposals.propose(
            latitude: insideLatitude,
            longitude: insideLongitude,
            accuracyMetres: 4,
            georeference: georeference(),
            objects: [area(id: "bed-1", category: .bed, from: Position(x: 0, y: 0), size: 30)]
        )
        #expect(proposal?.mapObjectId == "bed-1")
    }

    /// A bed inside a zone is the more useful answer, and nesting is normal
    /// here rather than exceptional.
    @Test("prefers the smallest area when they nest")
    func prefersSmallest() {
        let proposal = PlacementProposals.propose(
            latitude: insideLatitude,
            longitude: insideLongitude,
            accuracyMetres: 4,
            georeference: georeference(),
            objects: [
                area(id: "zone-1", category: .zone, from: Position(x: 0, y: 0), size: 40),
                area(id: "bed-1", category: .bed, from: Position(x: 0, y: 0), size: 20),
            ]
        )
        #expect(proposal?.mapObjectId == "bed-1")
    }

    /// A fence is somewhere to stand, not somewhere to plant.
    @Test("ignores areas nothing can be planted in")
    func ignoresNonPlantable() {
        let proposal = PlacementProposals.propose(
            latitude: insideLatitude,
            longitude: insideLongitude,
            accuracyMetres: 4,
            georeference: georeference(),
            objects: [area(id: "lot-1", category: .lot, from: Position(x: 0, y: 0), size: 40)]
        )
        #expect(proposal == nil)
    }

    /// Without a georeference the two spaces have no relationship at all.
    /// Inventing an origin would put every plant in the same wrong place with
    /// total confidence.
    @Test("says nothing when the garden has never been placed")
    func silentWithoutGeoreference() {
        let proposal = PlacementProposals.propose(
            latitude: insideLatitude,
            longitude: insideLongitude,
            accuracyMetres: 4,
            georeference: nil,
            objects: [area(id: "bed-1", category: .bed, from: Position(x: 0, y: 0), size: 30)]
        )
        #expect(proposal == nil)
    }

    @Test("says nothing when the coordinate is outside every area")
    func silentOutside() {
        let proposal = PlacementProposals.propose(
            latitude: 41.9000,
            longitude: -87.6000,
            accuracyMetres: 4,
            georeference: georeference(),
            objects: [area(id: "bed-1", category: .bed, from: Position(x: 0, y: 0), size: 30)]
        )
        #expect(proposal == nil)
    }

    /// A five-metre fix genuinely identifies a twenty-metre zone and says
    /// almost nothing about a one-metre herb bed. The proposal is still
    /// offered — it is usually right — but it says which of the two it is.
    @Test("reports whether the fix is tight enough for that particular area")
    func flagsAccuracyAgainstAreaSize() {
        let large = PlacementProposals.propose(
            latitude: insideLatitude, longitude: insideLongitude, accuracyMetres: 5,
            georeference: georeference(),
            objects: [area(id: "zone-1", category: .zone, from: Position(x: 0, y: 0), size: 40)]
        )
        #expect(large?.isWithinAccuracy == true)

        let tight = PlacementProposals.propose(
            latitude: insideLatitude, longitude: insideLongitude, accuracyMetres: 25,
            georeference: georeference(),
            objects: [area(id: "zone-1", category: .zone, from: Position(x: 0, y: 0), size: 40)]
        )
        #expect(tight?.isWithinAccuracy == false)
    }

    /// A garden whose local axes are turned away from north. Ignoring the
    /// rotation puts the phone in the wrong bed while looking equally certain.
    @Test("applies the garden's rotation away from true north")
    func appliesRotation() {
        let straight = PlacementProposals.propose(
            latitude: insideLatitude, longitude: insideLongitude, accuracyMetres: 1,
            georeference: georeference(),
            objects: [area(id: "a", category: .bed, from: Position(x: 0, y: 0), size: 30)]
        )
        let turned = PlacementProposals.propose(
            latitude: insideLatitude, longitude: insideLongitude, accuracyMetres: 1,
            georeference: georeference(rotationDegrees: 90),
            objects: [area(id: "a", category: .bed, from: Position(x: 0, y: 0), size: 30)]
        )
        #expect(straight?.localPosition != turned?.localPosition)
    }
}
