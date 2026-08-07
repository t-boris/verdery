import CoreImage
import CoreImage.CIFilterBuiltins
import SwiftUI

/// Renders a link as a QR code.
///
/// First-party CoreImage, so no dependency and no ADR: `architecture/
/// ios-application-design.md` section 21 gates *third-party* dependencies, and
/// this is a filter Apple ships.
///
/// The correction level is deliberately high. A label staked in a garden is
/// rained on, faded by a summer, and splashed with soil; `H` recovers from
/// about thirty per cent of the code being unreadable, at the cost of a denser
/// pattern nobody is short of space for on a plant marker.
public enum QRCodeImage {
    /// - Returns: `nil` when CoreImage cannot render — a simulator without the
    ///   filter, or a string too long for the format. A caller shows the link
    ///   as text rather than an empty square.
    public static func generate(from text: String, scale: CGFloat = 12) -> Image? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "H"

        guard let output = filter.outputImage else { return nil }

        // The filter produces roughly one pixel per module, which renders as a
        // blur when scaled up by the view. Scaling the CIImage first keeps the
        // edges square, which is what a scanner needs.
        let scaled = output.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        let context = CIContext()
        guard let cgImage = context.createCGImage(scaled, from: scaled.extent) else { return nil }

        return Image(decorative: cgImage, scale: 1)
    }
}
