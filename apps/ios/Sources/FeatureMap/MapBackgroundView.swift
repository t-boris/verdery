import CoreDomain
import MapKit
import SwiftUI

/// Optional real-world context rendered behind the canonical `Canvas` layer,
/// shown only when the garden has a ``GardenGeoreference``.
///
/// This is the *only* file in `FeatureMap` — and, by construction, the only
/// file in the whole application outside `VerderyApp`'s own Xcode project
/// glue — that imports MapKit. That is what the work package's title means
/// by "without making canonical garden geometry provider-dependent": no
/// `CoreDomain` type has ever heard of `MKCoordinateRegion` or
/// `CLLocationCoordinate2D`, and `MapEditorViewModel` hands this view nothing
/// but the plain WGS84 longitude/latitude pair `GardenGeoreference` already
/// carries. Swapping MapKit for another provider later touches this one
/// file.
///
/// Read-only and decorative: the `Canvas` layer above owns every gesture and
/// every unit of interaction, so this view disables its own interaction and
/// hides itself from VoiceOver — the accessible object list, not this map,
/// is the real alternative to the canvas, per the work package's
/// accessibility requirement.
struct MapBackgroundView: View {
    let georeference: GardenGeoreference

    var body: some View {
        Map(initialPosition: .region(region))
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }

    private var region: MKCoordinateRegion {
        MKCoordinateRegion(
            center: CLLocationCoordinate2D(
                latitude: georeference.geographicAnchor.y,
                longitude: georeference.geographicAnchor.x
            ),
            latitudinalMeters: Self.defaultSpanMetres,
            longitudinalMeters: Self.defaultSpanMetres
        )
    }

    /// A generous fixed span around the garden's anchor. This pass has no UI
    /// to keep the backdrop's region in sync with the canvas's own pan/zoom —
    /// TODO(P3-IOS-02): derive the span from the render snapshot's content
    /// bounds and `georeference.scaleCorrection` once that alignment is
    /// designed, rather than a fixed guess.
    private static let defaultSpanMetres: CLLocationDistance = 200
}
