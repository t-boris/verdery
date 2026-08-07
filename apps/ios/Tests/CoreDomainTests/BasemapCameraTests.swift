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

    /// The one that actually catches a sign error: rotate the garden 90°
    /// clockwise from north and its local `+Y` points east, so walking up the
    /// canvas must move the camera east and not west.
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
        // The backdrop turns with the garden, so the two agree on which way
        // up is.
        #expect(camera.headingDegrees == 90)
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
}
