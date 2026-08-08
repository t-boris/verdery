import CoreDomain
import CoreLocation
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
        GeometryReader { geometry in
            MapReader { map in
                Map(position: $position)
                    .mapStyle(style.mapKitStyle)
                    // No compass, and no other MapKit control either. MapKit
                    // draws a compass of its own whenever the map is rotated,
                    // and a georeferenced garden rotates it on every visit —
                    // but `allowsHitTesting(false)` below hands every gesture
                    // to the `Canvas` on top, so tapping that compass does
                    // nothing at all. A control that looks like a control and
                    // is not one is worse than no control: the owner reported
                    // it as "the compass does not turn the map", which was an
                    // accurate description of a button this application never
                    // meant to offer. View rotation is a real gap and belongs
                    // to the canvas, not to the backdrop; when the canvas has
                    // it, the compass it draws will be its own and will work.
                    .mapControls {}
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
                    .onAppear { apply(camera, framedBy: map, in: geometry.size) }
                    // `onChange` rather than a computed `initialPosition`: the
                    // camera changes on every pan and zoom, and
                    // `initialPosition` is read once. That single word is the
                    // whole of the defect this replaced.
                    .onChange(of: camera) { _, updated in apply(updated, framedBy: map, in: geometry.size) }
                    // A rotation or a split view changes how much ground the
                    // same span has to cover, and the framing below is stated
                    // in terms of that shape.
                    .onChange(of: geometry.size) { _, resized in apply(camera, framedBy: map, in: resized) }
            }
        }
    }

    /// Points the backdrop at the ground the canvas is showing.
    ///
    /// The span is stated as a region and the distance is asked of MapKit,
    /// rather than the two being taken for each other. They are different
    /// quantities: a ``BasemapCamera`` carries how much ground the viewport
    /// covers, while `MapCamera.distance` is how far the camera sits above it,
    /// and what separates them is a field of view MapKit does not publish.
    /// Passing one as the other drew the garden over a photograph at the wrong
    /// scale — plausible enough to trace a bed onto, and wrong.
    ///
    /// ``MapProxy/camera(framing:)`` is the published bridge: MapKit converts
    /// the region into the camera it would itself use to frame it, so the
    /// unpublished quantity stays inside MapKit instead of becoming a constant
    /// nobody here could derive or check. The region is given the viewport's
    /// own aspect so that framing it binds on both axes at once — a square
    /// region in a portrait canvas would fit to the narrow side and show more
    /// ground vertically than was asked for.
    ///
    /// The heading is then set on the returned camera, because a region is
    /// north-up and cannot carry one. That is the whole reason this goes
    /// through a camera at all rather than `MapCameraPosition.region`.
    private func apply(_ camera: BasemapCamera, framedBy map: MapProxy, in size: CGSize) {
        guard size.width > 0, size.height > 0 else { return }

        let region = MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: camera.centre.y, longitude: camera.centre.x),
            latitudinalMeters: camera.spanMetres,
            longitudinalMeters: camera.spanMetres * (size.width / size.height)
        )
        var framed = map.camera(framing: region)
        framed.heading = camera.headingDegrees
        position = .camera(framed)
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
