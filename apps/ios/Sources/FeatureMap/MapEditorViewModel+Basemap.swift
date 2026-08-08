import CoreDomain
import CoreLocalization
import Foundation

/// The backdrop's camera, derived from the canvas's own viewport.
///
/// Separated from the view model's body so the arithmetic sits next to its
/// reason rather than inside a four-hundred-line class, and so this file stays
/// small enough to read in one screen — the same split
/// `MapEditorViewModel+Drafting.swift` already makes.
extension MapEditorViewModel {
    /// Where the basemap must look for the photograph to agree with the garden
    /// drawn on it, or `nil` when there is nothing to agree with: no
    /// georeference, or no viewport measured yet.
    ///
    /// Recomputed whenever `transform` or `viewportSize` changes, which is what
    /// makes the backdrop follow a pan instead of lying about one.
    public var basemapButtonTitle: String { strings(.georeferenceTitle) }
    public var georeferenceButtonTitle: String { strings(.georeferenceOpen) }

    public var basemapCamera: BasemapCamera? {
        guard let georeference, viewportSize.height > 0 else { return nil }

        let centreScreen = CGPoint(x: viewportSize.width / 2, y: viewportSize.height / 2)
        return BasemapCameras.derive(
            georeference: georeference,
            viewportCentreLocal: transform.localPosition(for: centreScreen),
            viewportHeightMetres: transform.localDistance(
                forScreenDistance: Double(viewportSize.height)
            ),
            // The canvas and the photograph turn together or they lie about
            // each other — the same requirement that makes the camera follow a
            // pan, applied to the one gesture the canvas gained last.
            viewRotationDegrees: transform.rotationDegrees
        )
    }
}
