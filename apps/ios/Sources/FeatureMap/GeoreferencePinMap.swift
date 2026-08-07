import CoreDesignSystem
import CoreDomain
import SwiftUI

#if canImport(MapKit) && os(iOS)
    import MapKit
#endif

/// Dropping a pin by dragging the map under a fixed crosshair.
///
/// The crosshair does not move and the map does — the opposite of dragging a
/// pin, and better for one reason: a fingertip covers roughly the area a garden
/// occupies at this zoom, so a pin you drag is a pin you cannot see while you
/// place it. Moving the world under a fixed sight keeps the target visible the
/// whole time.
///
/// The camera is read on change rather than written back, so this view never
/// fights the person panning it.
struct GeoreferencePinMap: View {
    let initialAnchor: Position?
    let onChange: (Position) -> Void

    var body: some View {
        #if canImport(MapKit) && os(iOS)
            MapReader(initialAnchor: initialAnchor, onChange: onChange)
        #else
            // The headless macOS build this package also compiles for has no
            // business drawing a basemap; the other two ways in still work.
            EmptyView()
        #endif
    }
}

#if canImport(MapKit) && os(iOS)
    private struct MapReader: View {
        let initialAnchor: Position?
        let onChange: (Position) -> Void

        @State private var camera: MapCameraPosition = .automatic
        @ScaledSize(220) private var mapHeight

        var body: some View {
            ZStack {
                Map(position: $camera)
                    // Imagery, not the standard map: somebody placing a garden
                    // is looking for their own roof and their own hedge, and a
                    // street map shows neither.
                    .mapStyle(.imagery)
                    .onMapCameraChange(frequency: .onEnd) { context in
                        let centre = context.camera.centerCoordinate
                        onChange(Position(x: centre.longitude, y: centre.latitude))
                    }

                crosshair
            }
            .frame(height: mapHeight)
            .clipShape(RoundedRectangle(cornerRadius: Metrics.radiusCard, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: Metrics.radiusCard, style: .continuous)
                    .strokeBorder(Palette.border, lineWidth: Metrics.hairline)
            )
            .onAppear {
                guard let initialAnchor else { return }
                camera = .region(
                    MKCoordinateRegion(
                        center: CLLocationCoordinate2D(
                            latitude: initialAnchor.y,
                            longitude: initialAnchor.x
                        ),
                        // Roughly a large lot. Close enough to recognise a
                        // building, wide enough not to be lost in a lawn.
                        latitudinalMeters: 150,
                        longitudinalMeters: 150
                    )
                )
            }
        }

        /// Drawn rather than pinned: a `Marker` would be placed at a
        /// coordinate, and the whole point is that this one is placed at the
        /// screen's centre whatever coordinate is under it.
        private var crosshair: some View {
            Image(systemName: "plus.viewfinder")
                .imageScale(.large)
                .foregroundStyle(Palette.interaction)
                .shadow(radius: Metrics.hairline)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
    }
#endif
