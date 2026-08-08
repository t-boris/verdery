import Foundation
import Testing

@testable import CoreDomain

/// The backdrop's camera.
///
/// This arithmetic is worth testing because getting it wrong does not look
/// wrong: an aerial photograph offset by ten metres, or drifting the correct
/// distance in the wrong direction, is a perfectly plausible picture that a
/// person will trace a bed onto.
@Suite("Basemap camera")
struct BasemapCameraTests {
    private func georeference(
        anchor: Position = Position(x: -122.4194, y: 37.7749),
        rotationDegrees: Double = 0,
        scaleCorrection: Double = 1
    ) -> GardenGeoreference {
        GardenGeoreference(
            localAnchor: Position(x: 0, y: 0),
            geographicAnchor: anchor,
            rotationDegrees: rotationDegrees,
            scaleCorrection: scaleCorrection,
            provenance: .manualDrawing,
            method: "mapPin",
            revision: 1
        )
    }

    /// Looking at the origin means looking at the anchor. Anything else is an
    /// offset error hiding in the identity case.
    @Test("puts the anchor under a viewport centred on the local origin")
    func originMapsToAnchor() {
        let camera = BasemapCameras.derive(
            georeference: georeference(),
            viewportCentreLocal: Position(x: 0, y: 0),
            viewportHeightMetres: 40
        )
        #expect(abs(camera.centre.x - (-122.4194)) < 1e-9)
        #expect(abs(camera.centre.y - 37.7749) < 1e-9)
        #expect(camera.spanMetres == 40)
        #expect(camera.headingDegrees == 0)
    }

    /// With no rotation, local `+Y` is north and local `+X` is east. A hundred
    /// metres north is about 0.0009 degrees of latitude.
    @Test("moves north for local +Y and east for local +X")
    func unrotatedAxes() {
        let base = georeference()
        let north = BasemapCameras.derive(
            georeference: base,
            viewportCentreLocal: Position(x: 0, y: 100),
            viewportHeightMetres: 40
        )
        #expect(north.centre.y > base.geographicAnchor.y)
        #expect(abs(north.centre.x - base.geographicAnchor.x) < 1e-9)
        #expect(abs((north.centre.y - base.geographicAnchor.y) - 100 / 111_320.0) < 1e-9)

        let east = BasemapCameras.derive(
            georeference: base,
            viewportCentreLocal: Position(x: 100, y: 0),
            viewportHeightMetres: 40
        )
        #expect(east.centre.x > base.geographicAnchor.x)
        #expect(abs(east.centre.y - base.geographicAnchor.y) < 1e-9)
    }

    /// The one that actually catches a sign error: at `rotationDegrees` 90 the
    /// garden's local `+Y` points WEST — that is what
    /// `GeographicProjection.localPosition`'s convention makes it — so walking
    /// up the canvas must move the camera west.
    @Test("respects the garden's rotation against north")
    func rotatedAxes() {
        let base = georeference(rotationDegrees: 90)
        let camera = BasemapCameras.derive(
            georeference: base,
            viewportCentreLocal: Position(x: 0, y: 100),
            viewportHeightMetres: 40
        )
        #expect(camera.centre.x < base.geographicAnchor.x)
        #expect(abs(camera.centre.y - base.geographicAnchor.y) < 1e-6)
        // And the backdrop is told to put that same west at the top, which is
        // the INVERSE of the garden's rotation. This assertion read `== 90`
        // while the two above already said "west", and the contradiction
        // shipped: at 90° it turns the photograph a half-turn under a drawing
        // that still looks plausible.
        #expect(camera.headingDegrees == -90)
    }

    /// The heading, pinned against the projection rather than against itself.
    ///
    /// `roundTripsThroughProjection` covers the centre and says nothing about
    /// which way up the backdrop is told to be, which is how a sign error in
    /// the heading survived a suite that passed. The property: the bearing
    /// from the anchor to a point one metre UP the canvas is the bearing the
    /// camera asks the basemap to put at the top of the screen.
    @Test("heads the backdrop along the direction the canvas draws upward")
    func headingMatchesTheCanvasUpDirection() {
        for rotation in [0.0, 37.0, 90.0, 213.5, 359.0] {
            let reference = georeference(rotationDegrees: rotation)
            let origin = BasemapCameras.derive(
                georeference: reference,
                viewportCentreLocal: Position(x: 0, y: 0),
                viewportHeightMetres: 40
            )
            let oneMetreUp = BasemapCameras.derive(
                georeference: reference,
                viewportCentreLocal: Position(x: 0, y: 1),
                viewportHeightMetres: 40
            )

            let metresPerDegreeLatitude = 111_320.0
            let northMetres = (oneMetreUp.centre.y - origin.centre.y) * metresPerDegreeLatitude
            let eastMetres =
                (oneMetreUp.centre.x - origin.centre.x)
                * metresPerDegreeLatitude * cos(origin.centre.y * .pi / 180)
            let bearing = atan2(eastMetres, northMetres) * 180 / .pi

            // Both reduced to the same turn before comparing: -90 and 270 name
            // one direction, and a test that cannot say so would fail on an
            // implementation that is right.
            let difference = (bearing - origin.headingDegrees).truncatingRemainder(dividingBy: 360)
            let wrapped = min(abs(difference), 360 - abs(difference))
            #expect(wrapped < 0.01, "rotation \(rotation): heading \(origin.headingDegrees), canvas up bears \(bearing)")
        }
    }

    /// A round trip through the projection is the strongest statement
    /// available: whatever the conventions are, the two directions must be
    /// each other's inverse.
    @Test("inverts the projection exactly")
    func roundTripsThroughProjection() {
        for rotation in [0.0, 37.0, 90.0, 213.5, 359.0] {
            let reference = georeference(rotationDegrees: rotation)
            let local = Position(x: 12.5, y: -7.25)

            let camera = BasemapCameras.derive(
                georeference: reference,
                viewportCentreLocal: local,
                viewportHeightMetres: 30
            )
            let back = GeographicProjection.localPosition(
                latitude: camera.centre.y,
                longitude: camera.centre.x,
                georeference: reference
            )

            #expect(back != nil)
            #expect(abs((back?.x ?? 0) - local.x) < 0.01)
            #expect(abs((back?.y ?? 0) - local.y) < 0.01)
        }
    }

    /// A survey correction says the garden's metres differ from the Earth's,
    /// which changes how much ground a viewport covers — not where its centre
    /// is when it sits on the anchor.
    @Test("applies scale correction to the span")
    func scaleCorrection() {
        let camera = BasemapCameras.derive(
            georeference: georeference(scaleCorrection: 1.02),
            viewportCentreLocal: Position(x: 0, y: 0),
            viewportHeightMetres: 100
        )
        #expect(abs(camera.spanMetres - 102) < 1e-9)
    }

    /// Below roughly a metre the imagery is pure magnification, and a camera
    /// distance of zero is not a camera at all.
    @Test("never asks for a span of nothing")
    func minimumSpan() {
        let camera = BasemapCameras.derive(
            georeference: georeference(),
            viewportCentreLocal: Position(x: 0, y: 0),
            viewportHeightMetres: 0.001
        )
        #expect(camera.spanMetres == BasemapCameras.minimumSpanMetres)
    }

    /// The camera's own rotation joins the georeference's in one sum. Turning
    /// the drawing clockwise puts a bearing that much further anticlockwise at
    /// the top of the screen, so the backdrop has to turn with it — the same
    /// requirement that makes it follow a pan.
    @Test("adds the canvas's own rotation to the heading")
    func viewRotationJoinsTheHeading() {
        let unrotatedGarden = BasemapCameras.derive(
            georeference: georeference(),
            viewportCentreLocal: Position(x: 0, y: 0),
            viewportHeightMetres: 40,
            viewRotationDegrees: 30
        )
        #expect(abs(unrotatedGarden.headingDegrees - (-30)) < 1e-9)

        let both = BasemapCameras.derive(
            georeference: georeference(rotationDegrees: 20),
            viewportCentreLocal: Position(x: 0, y: 0),
            viewportHeightMetres: 40,
            viewRotationDegrees: 30
        )
        #expect(abs(both.headingDegrees - (-50)) < 1e-9)
    }

    /// The default keeps every existing caller and fixture meaning what it
    /// meant: a canvas that draws the garden's `+Y` upward has no rotation of
    /// its own.
    @Test("defaults to a canvas that has not been turned")
    func viewRotationDefaultsToNone() {
        let camera = BasemapCameras.derive(
            georeference: georeference(rotationDegrees: 20),
            viewportCentreLocal: Position(x: 0, y: 0),
            viewportHeightMetres: 40
        )
        #expect(abs(camera.headingDegrees - (-20)) < 1e-9)
    }
}
