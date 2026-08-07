import Foundation

/// Converting a real-world coordinate into the garden's own planar space.
///
/// ADR-0005 keeps accepted geometry in a garden-local planar space measured in
/// metres, with an optional transform onto WGS84. Everything in the product
/// works in the local space; a device's GPS speaks the other one. This is the
/// bridge, and the only place that arithmetic lives.
///
/// Deliberately a local tangent-plane approximation rather than a full
/// projection: a garden is tens of metres across, where the error from
/// treating the Earth as flat is millimetres — well under ADR-0010's own 1 mm
/// rounding — and the alternative would be a projection library this package
/// does not have and does not need. It is wrong for a continent and exact
/// enough for a plot.
public enum GeographicProjection {
    /// Metres per degree of latitude. Constant enough at garden scale; the
    /// variation between the equator and the poles is about 1%, which over
    /// a hundred metres is a centimetre.
    private static let metresPerDegreeLatitude = 111_320.0

    /// Places a WGS84 coordinate in the garden's local metres.
    ///
    /// Returns `nil` when the garden has no georeference: without one there is
    /// no relationship between the two spaces, and inventing an origin would
    /// put every plant in the same wrong place with total confidence.
    public static func localPosition(
        latitude: Double,
        longitude: Double,
        georeference: GardenGeoreference
    ) -> Position? {
        let anchorLongitude = georeference.geographicAnchor.x
        let anchorLatitude = georeference.geographicAnchor.y

        // A degree of longitude narrows toward the poles; a degree of latitude
        // does not. Taken at the anchor rather than at the point, so two
        // photographs metres apart cannot land on different scales.
        let metresPerDegreeLongitude =
            metresPerDegreeLatitude * cos(anchorLatitude * .pi / 180)

        let eastMetres = (longitude - anchorLongitude) * metresPerDegreeLongitude
        let northMetres = (latitude - anchorLatitude) * metresPerDegreeLatitude

        // The georeference records how far the local space is rotated from
        // true north, so the inverse rotation brings a compass-aligned offset
        // back into it.
        let radians = -georeference.rotationDegrees * .pi / 180
        let rotatedEast = eastMetres * cos(radians) - northMetres * sin(radians)
        let rotatedNorth = eastMetres * sin(radians) + northMetres * cos(radians)

        let scale = georeference.scaleCorrection == 0 ? 1 : georeference.scaleCorrection
        return Position(
            x: georeference.localAnchor.x + rotatedEast / scale,
            y: georeference.localAnchor.y + rotatedNorth / scale
        )
    }

    /// Moves a WGS84 coordinate by a compass-aligned offset in metres.
    ///
    /// The other direction from ``localPosition(latitude:longitude:georeference:)``,
    /// and the same tangent-plane approximation for the same reason. Used to
    /// derive where a basemap's camera must sit so the photograph under the
    /// canvas agrees with the garden drawn on it.
    ///
    /// The longitude scale is taken at the origin coordinate rather than at
    /// the result, so panning across a garden cannot walk the scale.
    public static func offset(
        from origin: Position,
        eastMetres: Double,
        northMetres: Double
    ) -> Position {
        let metresPerDegreeLongitude =
            metresPerDegreeLatitude * cos(origin.y * .pi / 180)
        // At a pole a degree of longitude has no width and the division is
        // meaningless. No garden is there; guarding is cheaper than the NaN
        // that would otherwise reach a camera.
        let longitudeDelta = abs(metresPerDegreeLongitude) < 1
            ? 0
            : eastMetres / metresPerDegreeLongitude
        return Position(
            x: origin.x + longitudeDelta,
            y: origin.y + northMetres / metresPerDegreeLatitude
        )
    }
}
