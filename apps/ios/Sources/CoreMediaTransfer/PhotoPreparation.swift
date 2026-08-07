import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// What a photograph carries besides its pixels, and what to do about it.
public struct PhotoPreparationResult: Sendable, Equatable {
    /// The bytes to upload.
    public let data: Data
    /// The coordinate the camera recorded, read out before it was removed.
    ///
    /// Kept locally so the capture flow can propose which bed a plant is in
    /// (the phone is standing next to it), and stripped from what goes to the
    /// server, which has no use for it.
    public let capturedLatitude: Double?
    public let capturedLongitude: Double?
    /// Whether the pixels were reduced.
    public let wasDownscaled: Bool
}

/// Gets a captured photograph ready to leave the device.
///
/// Two jobs, both of which have to happen before the first byte is uploaded.
///
/// **Reduce it.** `tasks/lessons.md` records what happens otherwise: a
/// 30.79 MiB original came back from the identification provider as a bare
/// `400`, was mapped to `providerFailed`, and a person read that as "no species
/// found" on a plant they had just photographed. The lesson drawn there was
/// that the limit belongs above the adapter and the caller should refuse
/// before the call — this refuses by making the file small enough instead.
/// It is also most of the reason a walk through a weak signal ever finishes.
///
/// **Strip the location.** Photographs upload with EXIF GPS untouched today,
/// which `docs/development/ios-distribution.md` names as the behaviour most
/// people would not expect. The coordinate is genuinely useful — locally, to
/// guess which bed a plant is in — so it is read first and then removed,
/// rather than being thrown away or silently shipped.
public enum PhotoPreparation {
    /// The longest edge an uploaded photograph is allowed to have.
    ///
    /// Comfortably above what species identification needs, and far below what
    /// a modern phone camera produces. The original is not what is being
    /// preserved here — the journal's own full-resolution copy is a separate
    /// concern; this is the file that has to cross a rural connection.
    public static let maximumPixelSize = 2048

    /// Reads the location, strips it, and reduces the image if it is large.
    ///
    /// Returns the input unchanged rather than throwing when the data is not
    /// an image this device can decode: refusing to attach a photograph
    /// because it could not be optimised would trade a small problem for a
    /// total one.
    public static func prepare(_ data: Data, contentType: String) -> PhotoPreparationResult {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else {
            return PhotoPreparationResult(
                data: data, capturedLatitude: nil, capturedLongitude: nil, wasDownscaled: false
            )
        }

        let coordinate = location(in: source)
        let type = (contentType == "image/png" ? UTType.png : UTType.jpeg)

        guard
            let reduced = redraw(source, as: type)
        else {
            return PhotoPreparationResult(
                data: data,
                capturedLatitude: coordinate?.latitude,
                capturedLongitude: coordinate?.longitude,
                wasDownscaled: false
            )
        }

        return PhotoPreparationResult(
            data: reduced,
            capturedLatitude: coordinate?.latitude,
            capturedLongitude: coordinate?.longitude,
            wasDownscaled: reduced.count < data.count
        )
    }

    /// Redrawing through a thumbnail is what removes the metadata: the
    /// destination is written from pixels alone, so nothing survives that was
    /// not explicitly copied — which is a stronger guarantee than deleting the
    /// GPS dictionary and hoping no other tag carries a location.
    private static func redraw(_ source: CGImageSource, as type: UTType) -> Data? {
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maximumPixelSize,
        ]
        guard
            let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary),
            let output = CFDataCreateMutable(nil, 0),
            let destination = CGImageDestinationCreateWithData(
                output, type.identifier as CFString, 1, nil
            )
        else {
            return nil
        }

        CGImageDestinationAddImage(
            destination, image, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary
        )
        guard CGImageDestinationFinalize(destination) else { return nil }
        return output as Data
    }

    private static func location(
        in source: CGImageSource
    ) -> (latitude: Double, longitude: Double)? {
        guard
            let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil)
                as? [CFString: Any],
            let gps = properties[kCGImagePropertyGPSDictionary] as? [CFString: Any],
            let latitude = gps[kCGImagePropertyGPSLatitude] as? Double,
            let longitude = gps[kCGImagePropertyGPSLongitude] as? Double
        else {
            return nil
        }

        // EXIF stores magnitude and hemisphere separately; a photograph taken
        // south of the equator or west of Greenwich is otherwise placed in the
        // wrong quadrant of the world.
        let latitudeRef = gps[kCGImagePropertyGPSLatitudeRef] as? String
        let longitudeRef = gps[kCGImagePropertyGPSLongitudeRef] as? String
        return (
            latitude: latitudeRef == "S" ? -latitude : latitude,
            longitude: longitudeRef == "W" ? -longitude : longitude
        )
    }
}
