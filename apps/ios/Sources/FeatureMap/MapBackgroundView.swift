import CoreDomain
import MapKit
import SwiftUI

/// Real-world context rendered behind the canonical `Canvas` layer, shown only
/// when the garden has a ``GardenGeoreference``.
///
/// This is the *only* file in `FeatureMap` — and, by construction, the only
/// file in the whole application outside `VerderyApp`'s own Xcode project glue
/// — that imports MapKit. That is what "without making canonical garden
/// geometry provider-dependent" means: no `CoreDomain` type has ever heard of
/// `MKCoordinateRegion` or `CLLocationCoordinate2D`, and the camera it draws
/// arrives as a plain ``BasemapCamera`` derived by pure, tested arithmetic.
/// Swapping MapKit for another provider later touches this one file.
///
/// **It follows the canvas.** An earlier pass pinned a fixed 200-metre span at
/// the anchor and never updated it, so panning or zooming left the photograph
/// still underneath — imagery that actively claimed a bed was somewhere it was
/// not. That is worse than no imagery, because a wrong picture is believed. The
/// camera is now recomputed from the same viewport transform the canvas draws
/// with, every time it changes.
///
/// Read-only and decorative in the interaction sense: the `Canvas` above owns
/// every gesture, so this view disables its own hit testing and hides itself
/// from VoiceOver — the accessible object list, not this map, is the real
/// alternative to the canvas.
struct MapBackgroundView: View {
    let camera: BasemapCamera
    let style: BasemapStyle

    @State private var position: MapCameraPosition = .automatic

    var body: some View {
        Map(position: $position)
            .mapStyle(style.mapKitStyle)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
            .onAppear { apply(camera) }
            // `onChange` rather than a computed `initialPosition`: the camera
            // changes on every pan and zoom, and `initialPosition` is read once.
            // That single word is the whole of the defect this replaced.
            .onChange(of: camera) { _, updated in apply(updated) }
    }

    private func apply(_ camera: BasemapCamera) {
        position = .camera(
            MapCamera(
                centerCoordinate: CLLocationCoordinate2D(
                    latitude: camera.centre.y,
                    longitude: camera.centre.x
                ),
                // MapKit measures distance from the camera to the ground, and
                // the derivation produces a ground span. They differ by the
                // field of view; at a garden's scale, taking one for the other
                // is close enough to keep the picture aligned and far simpler
                // than a projection nobody can check.
                distance: camera.spanMetres,
                heading: camera.headingDegrees
            )
        )
    }
}

/// Which backdrop to draw.
///
/// Two, not a provider list: aerial imagery for tracing what is actually there,
/// and the standard map for recognising where the plot sits among streets.
/// MapKit's standard styling beats a raster street tile set here, and sidesteps
/// a tile-usage policy this application would otherwise have to honour.
public enum BasemapStyle: String, CaseIterable, Sendable {
    case imagery
    case standard

    var mapKitStyle: MapStyle {
        switch self {
        case .imagery: .imagery
        case .standard: .standard
        }
    }

    public var symbol: String {
        switch self {
        case .imagery: "globe.americas.fill"
        case .standard: "map"
        }
    }
}
