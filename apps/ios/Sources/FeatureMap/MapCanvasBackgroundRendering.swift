import CoreDomain
import SwiftUI

/// The imported-background underlay half of `MapCanvasView`'s drawing
/// (P6-PLAN iOS parity), split into its own file per the repository's
/// source-size rule. Same posture as the rest of the canvas: thin drawing
/// over the independently tested placement math (`MapBackgroundPlacement`).
extension MapCanvasView {
    /// The underlay pass: every layer's plan raster, in document order,
    /// with the in-flight drag offset applied to the dragged background so
    /// the imagery moves live with its outline.
    func drawBackgroundImages(
        context: GraphicsContext,
        transform: MapViewportTransform,
        dragObjectId: String?,
        dragTranslation: CGSize
    ) {
        for layer in backgroundLayers {
            drawBackgroundImage(
                layer,
                context: context,
                transform: transform,
                extraOffset: (layer.id == dragObjectId) ? dragTranslation : .zero
            )
        }
    }

    /// The badge pass, drawn above the geometry — see `drawBackgroundBadge`.
    func drawBackgroundBadges(
        context: GraphicsContext,
        transform: MapViewportTransform,
        dragObjectId: String?,
        dragTranslation: CGSize
    ) {
        for layer in backgroundLayers {
            drawBackgroundBadge(
                layer,
                context: context,
                transform: transform,
                extraOffset: (layer.id == dragObjectId) ? dragTranslation : .zero
            )
        }
    }

    /// Draws one imported background's plan raster under the garden
    /// geometry: at its similarity transform when calibrated (or while a
    /// calibration preview is live), contain-fit inside its polygon's
    /// bounding box otherwise — the same placement rules as the web canvas
    /// (`MapBackgroundPlacement`). A layer with no resolved image (still
    /// loading, or a PDF with nothing displayable) draws nothing here; its
    /// object outline and honest badge still render.
    func drawBackgroundImage(
        _ layer: MapBackgroundRenderLayer,
        context: GraphicsContext,
        transform: MapViewportTransform,
        extraOffset: CGSize
    ) {
        guard let planImage = layer.image else { return }
        let image = Image(decorative: planImage.image, scale: 1)

        // `GraphicsContext` is a value type: transforms and opacity applied
        // to this copy never leak into the caller's drawing.
        var layerContext = context
        layerContext.opacity = layer.opacity

        switch layer.placement {
        case let .planTransform(planTransform, pageAspectRatio):
            let placement = MapBackgroundPlacement.calibratedImagePlacement(
                planTransform: planTransform,
                pageAspectRatio: pageAspectRatio,
                transform: transform
            )
            layerContext.translateBy(
                x: placement.topLeft.x + extraOffset.width,
                y: placement.topLeft.y + extraOffset.height
            )
            layerContext.rotate(by: .radians(placement.rotationRadians))
            layerContext.draw(
                image,
                in: CGRect(x: 0, y: 0, width: placement.width, height: placement.height)
            )

        case .containFit:
            guard let bounds = MapBackgroundPlacement.geometryScreenRect(layer.geometry, transform: transform)
            else { return }
            let fit = MapBackgroundPlacement.containFitRect(
                bounds: bounds,
                imageAspect: Double(planImage.pixelWidth) / Double(planImage.pixelHeight)
            )
            layerContext.draw(image, in: fit.offsetBy(dx: extraOffset.width, dy: extraOffset.height))
        }
    }

    /// The always-on state/quality badge ("Not calibrated" / "Calibrated ·
    /// ±N cm estimated error") at the background's top-left corner — drawn
    /// above the geometry so a dense plan never swallows it.
    func drawBackgroundBadge(
        _ layer: MapBackgroundRenderLayer,
        context: GraphicsContext,
        transform: MapViewportTransform,
        extraOffset: CGSize
    ) {
        guard let bounds = MapBackgroundPlacement.geometryScreenRect(layer.geometry, transform: transform)
        else { return }

        let anchor = CGPoint(
            x: bounds.origin.x + 4 + extraOffset.width,
            y: bounds.origin.y + 4 + extraOffset.height
        )
        let text = Text(layer.badgeText).font(.caption2)
        let resolved = context.resolve(text)
        let size = resolved.measure(in: CGSize(width: 400, height: 100))
        let padding: CGFloat = 3
        let plate = CGRect(
            x: anchor.x - padding,
            y: anchor.y - padding,
            width: size.width + padding * 2,
            height: size.height + padding * 2
        )
        context.fill(Path(roundedRect: plate, cornerRadius: 4), with: .color(.white.opacity(0.75)))
        context.draw(resolved, in: CGRect(origin: anchor, size: size))
    }
}
