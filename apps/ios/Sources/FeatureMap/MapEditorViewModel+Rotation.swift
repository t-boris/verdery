import CoreDomain
import CoreGraphics
import CoreLocalization

/// Turning the view.
///
/// "View rotation is part of the local camera, not an object mutation. The
/// editor provides 15-degree clockwise/counter-clockwise steps, an exact degree
/// input, and North up. The same camera transform is applied to every local
/// object and to the MapLibre bearing, so a lot, structures, labels and
/// backdrop cannot rotate or zoom independently"
/// (architecture/map-rendering-and-editing.md, section 3.2). The web editor has
/// had all four since it was built; this client had none of them, and the
/// compass it appeared to offer was MapKit's own and inert.
///
/// Nothing here submits a command. Every entry point moves `transform` only,
/// and `MapEditorViewModel+Basemap` derives the backdrop's bearing from the
/// same value, so the drawing and the photograph cannot turn independently.
extension MapEditorViewModel {
    /// The step the two nudge controls take, per the architecture document.
    public static let rotationStepDegrees: Double = 15

    public var rotationDegrees: Double { transform.rotationDegrees }

    /// A continuous turn, from the two-finger gesture, about the point the
    /// fingers are holding.
    public func rotate(by degrees: Double, around anchor: CGPoint) {
        transform = transform.rotated(by: degrees, around: anchor)
    }

    /// One 15° step. Anchored on the middle of the canvas rather than on a
    /// finger: a button press has no location, and turning about the corner of
    /// an off-screen local origin would throw the garden out of view.
    public func nudgeRotation(clockwise: Bool) {
        rotate(
            by: clockwise ? Self.rotationStepDegrees : -Self.rotationStepDegrees,
            around: viewportCentre
        )
    }

    /// An exact angle, for somebody who knows the number they want.
    public func setRotation(degrees: Double) {
        guard degrees.isFinite else { return }
        rotate(by: degrees - transform.rotationDegrees, around: viewportCentre)
    }

    /// True north at the top of the screen.
    ///
    /// The inverse of the accepted georeference rotation, which is what makes
    /// the backdrop's bearing — the negated sum of the two — come out at zero.
    /// The document is explicit that this "does not rewrite that
    /// georeference": it moves the camera, and the garden's own relationship
    /// to north is untouched.
    public func alignNorthUp() {
        setRotation(degrees: -(georeference?.rotationDegrees ?? 0))
    }

    /// Where true north is on screen, clockwise from up — what the compass
    /// needle points along.
    ///
    /// NOT the view rotation. The bearing at the top of the screen is
    /// `-(georeference.rotationDegrees + view rotation)`, so north sits at the
    /// negation of that, which is the sum itself. Turning the needle by the
    /// view rotation alone leaves out the garden's own angle entirely, and on a
    /// garden rotated 90° it points the needle up while north is to the right —
    /// which is what shipped in the first draft of this control and what
    /// looking at it caught.
    public var northIndicatorDegrees: Double {
        (georeference?.rotationDegrees ?? 0) + transform.rotationDegrees
    }

    /// Whether the view is already north-up, to within a degree.
    ///
    /// A tolerance rather than equality: the continuous gesture lands on
    /// fractions, and a control that claims the view is not north-up when it is
    /// off by a thousandth of a degree is lying about something nobody can see.
    /// `nil` for a garden with no georeference, where north is not known and
    /// the control has nothing to mean.
    public var isNorthUp: Bool? {
        guard let georeference else { return nil }
        let difference = (transform.rotationDegrees + georeference.rotationDegrees)
            .truncatingRemainder(dividingBy: 360)
        return min(abs(difference), 360 - abs(difference)) < 1
    }

    /// Where a control-driven rotation turns about. Falls back to the local
    /// origin only before the canvas has been measured, when there is no
    /// meaningful centre and no drawing to keep still either.
    private var viewportCentre: CGPoint {
        CGPoint(x: viewportSize.width / 2, y: viewportSize.height / 2)
    }

    // MARK: - Wording

    public var northUpTitle: String { strings(MapRotationLocalizationKey.northUp) }
    public var rotationExactTitle: String { strings(MapRotationLocalizationKey.exact) }
    public var rotationApplyTitle: String { strings(MapRotationLocalizationKey.apply) }

    public func rotationStepTitle(clockwise: Bool) -> String {
        strings(clockwise ? MapRotationLocalizationKey.clockwise : MapRotationLocalizationKey.counterclockwise)
    }

    /// What the compass reads out to VoiceOver. Spoken as a sentence, because
    /// "037" is a number and "turned 37 degrees clockwise" is the fact.
    public var rotationValueDescription: String {
        strings.string(MapRotationLocalizationKey.value, parameters: ["degrees": rotationShortDescription])
    }

    /// The number beside the needle. Whole degrees: the gesture lands on
    /// fractions and nobody is steering by a tenth of one.
    public var rotationShortDescription: String {
        String(Int(rotationDegrees.rounded()) % 360)
    }
}
