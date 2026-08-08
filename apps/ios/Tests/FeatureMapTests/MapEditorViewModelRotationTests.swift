import CoreDomain
import CoreGraphics
import CoreLocalization
import CoreNetworking
import Foundation
import Testing

@testable import FeatureMap

/// Turning the view — the four controls the architecture document has always
/// specified (15° steps, an exact angle, North up, and a continuous gesture)
/// and this client had none of.
///
/// The property that matters in all of them is that turning the view moves no
/// accepted coordinate: it is a camera, not a mutation.
@MainActor
@Suite("Map editor view model — view rotation")
struct MapEditorViewModelRotationTests {
    private func tree(id: String = "tree-1", x: Double = 0, y: Double = 0) -> GardenMapObject {
        GardenMapObject(
            id: id,
            gardenId: "garden-1",
            category: .tree,
            geometry: .point(Position(x: x, y: y)),
            coordinateSpaceId: "space-1",
            label: "Old Oak",
            categoryDetails: nil,
            lifecycleState: .active,
            revision: 1,
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0)
        )
    }

    private func georeference(rotationDegrees: Double) -> GardenGeoreference {
        GardenGeoreference(
            localAnchor: Position(x: 0, y: 0),
            geographicAnchor: Position(x: -122.4194, y: 37.7749),
            rotationDegrees: rotationDegrees,
            scaleCorrection: 1,
            provenance: .manualDrawing,
            method: "mapPin",
            revision: 1
        )
    }

    private func makeModel(_ gateway: FakeMapGateway) -> MapEditorViewModel {
        let localStore = InMemoryMapStore()
        return MapEditorViewModel(
            gardenId: "garden-1",
            loadGardenMap: LoadGardenMap(gateway: gateway, localStore: localStore),
            submitMapCommand: SubmitMapCommand(gateway: gateway),
            applyMapCommandOffline: ApplyMapCommandOffline(localStore: localStore, profileId: "profile-1"),
            listGardenPlanMedia: ListGardenPlanMedia(gateway: FakeMapMediaGateway()),
            loadPlanBackgroundImage: LoadPlanBackgroundImage(gateway: FakeMapMediaGateway()),
            strings: LocalizedStrings(locale: Locale(identifier: "en_GB"))
        )
    }

    private func loadedModel(georeferenceRotation: Double? = nil) async -> MapEditorViewModel {
        let gateway = FakeMapGateway(objects: [tree()])
        gateway.georeference = georeferenceRotation.map(georeference(rotationDegrees:))
        let model = makeModel(gateway)
        await model.load()
        model.updateViewportSize(CGSize(width: 400, height: 400))
        return model
    }

    @Test("a nudge turns the view by fifteen degrees, both ways")
    func nudgeTurnsByAStep() async {
        let model = await loadedModel()

        model.nudgeRotation(clockwise: true)
        #expect(abs(model.rotationDegrees - 15) < 0.0001)

        model.nudgeRotation(clockwise: false)
        #expect(abs(model.rotationDegrees) < 0.0001)

        // And past zero the other way, rather than sticking at it.
        model.nudgeRotation(clockwise: false)
        #expect(abs(model.rotationDegrees - 345) < 0.0001)
    }

    @Test("an exact angle is taken as given")
    func exactAngleIsTaken() async {
        let model = await loadedModel()

        model.setRotation(degrees: 37.5)

        #expect(abs(model.rotationDegrees - 37.5) < 0.0001)
    }

    /// North up is the INVERSE of the accepted georeference rotation, which is
    /// what makes the backdrop's bearing — the negated sum of the two — come
    /// out at zero. Getting this sign wrong points the map at south.
    @Test("north up is the inverse of the garden's own rotation")
    func northUpInvertsTheGeoreference() async {
        let model = await loadedModel(georeferenceRotation: 20)

        model.alignNorthUp()

        #expect(abs(model.rotationDegrees - 340) < 0.0001)
        #expect(model.isNorthUp == true)
        #expect(model.basemapCamera?.headingDegrees.truncatingRemainder(dividingBy: 360) == 0)
    }

    @Test("north up on an unrotated garden leaves the view alone")
    func northUpOnAnUnrotatedGarden() async {
        let model = await loadedModel(georeferenceRotation: 0)
        model.setRotation(degrees: 90)

        model.alignNorthUp()

        #expect(abs(model.rotationDegrees) < 0.0001)
        #expect(model.isNorthUp == true)
    }

    /// A garden with no georeference has no north to point at, so the control
    /// has nothing to claim.
    @Test("north up means nothing without a georeference")
    func northUpIsUnknownWithoutAGeoreference() async {
        let model = await loadedModel()

        #expect(model.isNorthUp == nil)
    }

    /// The whole point of calling it a camera.
    @Test("turning the view moves no accepted coordinate")
    func rotatingMutatesNothing() async {
        let gateway = FakeMapGateway(objects: [tree(x: 3, y: 4)])
        let model = makeModel(gateway)
        await model.load()
        model.updateViewportSize(CGSize(width: 400, height: 400))

        model.nudgeRotation(clockwise: true)
        model.setRotation(degrees: 123)

        #expect(gateway.submittedCommands.isEmpty)
        guard case let .point(position)? = model.objectsById["tree-1"]?.geometry else {
            Issue.record("Expected point geometry")
            return
        }
        #expect(position == Position(x: 3, y: 4))
    }

    /// A control-driven turn holds the middle of the canvas still, so the
    /// garden stays where the reader was looking instead of swinging around a
    /// local origin that is usually off-screen.
    @Test("a nudge keeps the middle of the canvas still")
    func nudgeHoldsTheCentre() async {
        let model = await loadedModel()
        let centre = CGPoint(x: 200, y: 200)
        let before = model.transform.localPosition(for: centre)

        model.nudgeRotation(clockwise: true)

        let after = model.transform.localPosition(for: centre)
        #expect(abs(after.x - before.x) < 0.0001)
        #expect(abs(after.y - before.y) < 0.0001)
    }

    /// The needle points at NORTH, whose screen angle is the garden's rotation
    /// plus the view's — not the view's alone. The first draft of the compass
    /// used the view rotation by itself, and on this exact garden it pointed
    /// the needle up while north was to the right. Nothing failed; it was
    /// caught by looking at the screen.
    @Test("the compass points at north, not at the view's own angle")
    func compassPointsAtNorth() async {
        let model = await loadedModel(georeferenceRotation: 90)

        // View unturned: the garden's `+Y` is drawn up and points west, so
        // north is a quarter turn clockwise from up.
        #expect(abs(model.northIndicatorDegrees - 90) < 0.0001)

        // Turn the view a further quarter clockwise and north follows it.
        model.nudgeRotation(clockwise: true)
        model.nudgeRotation(clockwise: true)
        model.nudgeRotation(clockwise: true)
        model.nudgeRotation(clockwise: true)
        model.nudgeRotation(clockwise: true)
        model.nudgeRotation(clockwise: true)
        #expect(abs(model.northIndicatorDegrees - 180) < 0.0001)

        // And north-up puts the needle back at the top, which is the whole
        // claim that control makes.
        model.alignNorthUp()
        let atTop = model.northIndicatorDegrees.truncatingRemainder(dividingBy: 360)
        #expect(min(abs(atTop), 360 - abs(atTop)) < 0.0001)
    }
}
