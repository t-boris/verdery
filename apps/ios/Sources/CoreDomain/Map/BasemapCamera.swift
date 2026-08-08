import Foundation

/// What a basemap must show for the garden drawn on top of it to be true.
///
/// The backdrop's whole value is alignment. A photograph that stays still while
/// the canvas pans is not decoration with a missing feature — it is a picture
/// actively claiming a bed is somewhere it is not, which is worse than no
/// picture at all.
///
/// So the camera is *derived*, every frame, from the same viewport the canvas
/// draws with. This type is that derivation, kept pure and platform-neutral so
/// it can be tested without MapKit and so no `CoreDomain` type ever hears of
/// `CLLocationCoordinate2D`.
public struct BasemapCamera: Sendable, Equatable {
    /// Longitude, latitude — WGS84, matching `GardenGeoreference`.
    public let centre: Position
    /// The north–south extent the viewport covers, in metres.
    public let spanMetres: Double
    /// The compass bearing the canvas draws upward, clockwise from true north.
    /// A backdrop told to put this bearing at the top of the screen agrees with
    /// the garden drawn over it.
    public let headingDegrees: Double

    public init(centre: Position, spanMetres: Double, headingDegrees: Double) {
        self.centre = centre
        self.spanMetres = spanMetres
        self.headingDegrees = headingDegrees
    }
}

public enum BasemapCameras {
    /// The smallest span worth asking a tile server for. Below roughly a metre
    /// the imagery is pure magnification and the camera stops being meaningful.
    public static let minimumSpanMetres: Double = 1

    /// Derives the camera that puts the garden's own coordinates under the
    /// canvas's current view.
    ///
    /// - Parameters:
    ///   - georeference: Where the garden's local origin sits, and how its
    ///     local axes are rotated against true north.
    ///   - viewportCentreLocal: The garden-local point currently at the centre
    ///     of the canvas — `transform.localPosition(for:)` of the viewport's
    ///     middle.
    ///   - viewportHeightMetres: How many garden-local metres the viewport's
    ///     height covers at the current zoom.
    ///
    /// Scale correction multiplies the span rather than the anchor: a survey
    /// correction says the garden's metres are slightly different from the
    /// Earth's, which changes how much ground the same viewport covers and not
    /// where its centre is.
    public static func derive(
        georeference: GardenGeoreference,
        viewportCentreLocal: Position,
        viewportHeightMetres: Double
    ) -> BasemapCamera {
        // The local offset from the anchor, rotated into true-north-relative
        // metres. The garden's `+Y` is `rotationDegrees` clockwise from north,
        // so recovering north-relative axes rotates by the same angle the
        // other way.
        let radians = georeference.rotationDegrees * .pi / 180
        let delta = Position(
            x: viewportCentreLocal.x - georeference.localAnchor.x,
            y: viewportCentreLocal.y - georeference.localAnchor.y
        )
        let scale = georeference.scaleCorrection
        // The exact inverse of `GeographicProjection.localPosition`, which
        // rotates a compass-aligned offset by `-rotationDegrees` to reach local
        // axes. Going back out therefore rotates by `+rotationDegrees` — get
        // this sign wrong and the backdrop drifts the correct distance in the
        // wrong direction, which looks like a plausible map.
        let eastMetres = (delta.x * cos(radians) - delta.y * sin(radians)) * scale
        let northMetres = (delta.x * sin(radians) + delta.y * cos(radians)) * scale

        let centre = GeographicProjection.offset(
            from: georeference.geographicAnchor,
            eastMetres: eastMetres,
            northMetres: northMetres
        )

        return BasemapCamera(
            centre: centre,
            spanMetres: max(viewportHeightMetres * scale, minimumSpanMetres),
            // The INVERSE of the garden's rotation, which is not the obvious
            // sign and was wrong here until a rotated garden was looked at.
            //
            // `rotationDegrees` is what `GeographicProjection.localPosition`
            // rotates a compass-aligned offset BY, negated, to reach local
            // axes. Run local `(0, 1)` back through that and it comes out at
            // east `-sin θ`, north `cos θ` — bearing `-θ`. So the garden's `+Y`
            // points θ degrees ANTICLOCKWISE of north, and since the canvas
            // draws `+Y` upward, `-θ` is the bearing at the top of the screen.
            //
            // The web editor says the same thing in one line —
            // `bearing: -(georeference.rotationDegrees + camera.rotationDegrees)`
            // in `basemap-provider.ts`, with the comment "the map bearing must
            // be the inverse of the georeference rotation". This port dropped
            // the minus. The error is 2θ, so it hides completely in the
            // unrotated garden every test and every screenshot used.
            headingDegrees: -georeference.rotationDegrees
        )
    }
}
