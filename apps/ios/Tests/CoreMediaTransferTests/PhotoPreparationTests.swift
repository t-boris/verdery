import CoreGraphics
import Foundation
import ImageIO
import Testing
import UniformTypeIdentifiers

@testable import CoreMediaTransfer

/// Getting a photograph ready to leave the device.
///
/// Both properties asserted here are ones a person would never notice were
/// broken: a location that ships to a server nobody expected to have it, and
/// an upload that is slow because the file is twelve megapixels of a leaf.
@Suite("Photo preparation")
struct PhotoPreparationTests {
    /// A JPEG of the given size, optionally carrying an EXIF coordinate.
    private func jpeg(
        width: Int,
        height: Int,
        latitude: Double? = nil,
        latitudeRef: String = "N",
        longitude: Double? = nil,
        longitudeRef: String = "E"
    ) -> Data {
        let context = CGContext(
            data: nil,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
        )
        context?.setFillColor(CGColor(red: 0.2, green: 0.5, blue: 0.3, alpha: 1))
        context?.fill(CGRect(x: 0, y: 0, width: width, height: height))
        guard let image = context?.makeImage() else { return Data() }

        let output = CFDataCreateMutable(nil, 0)!
        let destination = CGImageDestinationCreateWithData(
            output, UTType.jpeg.identifier as CFString, 1, nil
        )!

        var properties: [CFString: Any] = [:]
        if let latitude, let longitude {
            properties[kCGImagePropertyGPSDictionary] = [
                kCGImagePropertyGPSLatitude: latitude,
                kCGImagePropertyGPSLatitudeRef: latitudeRef,
                kCGImagePropertyGPSLongitude: longitude,
                kCGImagePropertyGPSLongitudeRef: longitudeRef,
            ]
        }
        CGImageDestinationAddImage(destination, image, properties as CFDictionary)
        CGImageDestinationFinalize(destination)
        return output as Data
    }

    private func longestEdge(of data: Data) -> Int {
        guard
            let source = CGImageSourceCreateWithData(data as CFData, nil),
            let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil)
                as? [CFString: Any],
            let width = properties[kCGImagePropertyPixelWidth] as? Int,
            let height = properties[kCGImagePropertyPixelHeight] as? Int
        else {
            return 0
        }
        return max(width, height)
    }

    private func hasGPS(_ data: Data) -> Bool {
        guard
            let source = CGImageSourceCreateWithData(data as CFData, nil),
            let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil)
                as? [CFString: Any]
        else {
            return false
        }
        return properties[kCGImagePropertyGPSDictionary] != nil
    }

    /// The lesson this exists for: a 30.79 MiB original was refused by the
    /// identification provider with a bare `400`, and a person read that as
    /// "no species found" on a plant they had just photographed.
    @Test("reduces a photograph larger than the upload ceiling")
    func downscalesLargeImages() {
        let original = jpeg(width: 4032, height: 3024)
        let prepared = PhotoPreparation.prepare(original, contentType: "image/jpeg")

        #expect(prepared.wasDownscaled)
        #expect(longestEdge(of: prepared.data) <= PhotoPreparation.maximumPixelSize)
        #expect(prepared.data.count < original.count)
    }

    @Test("leaves an already-small photograph alone")
    func keepsSmallImages() {
        let original = jpeg(width: 800, height: 600)
        let prepared = PhotoPreparation.prepare(original, contentType: "image/jpeg")
        #expect(longestEdge(of: prepared.data) <= 800)
    }

    /// Read locally, removed globally: the coordinate is what lets the capture
    /// flow propose which bed a plant is in, and it is of no use to a server.
    @Test("reads the coordinate out and then removes it")
    func stripsLocationAfterReadingIt() {
        let original = jpeg(width: 3000, height: 2000, latitude: 41.88, longitude: 87.63)
        #expect(hasGPS(original), "the fixture itself carries no GPS")

        let prepared = PhotoPreparation.prepare(original, contentType: "image/jpeg")
        #expect(prepared.capturedLatitude == 41.88)
        #expect(!hasGPS(prepared.data))
    }

    /// EXIF stores magnitude and hemisphere separately. Ignoring the reference
    /// places a garden in Chicago somewhere in China, which is exactly the kind
    /// of error a proposal would present with total confidence.
    @Test("applies the hemisphere references")
    func appliesHemisphere() {
        let southWest = jpeg(
            width: 1200, height: 900,
            latitude: 33.86, latitudeRef: "S",
            longitude: 151.2, longitudeRef: "W"
        )
        let prepared = PhotoPreparation.prepare(southWest, contentType: "image/jpeg")
        #expect(prepared.capturedLatitude == -33.86)
        #expect(prepared.capturedLongitude == -151.2)
    }

    /// Refusing to attach a photograph because it could not be optimised would
    /// trade a small problem for a total one.
    @Test("passes undecodable data through rather than failing")
    func passesThroughUnknownData() {
        let notAnImage = Data("this is not a photograph".utf8)
        let prepared = PhotoPreparation.prepare(notAnImage, contentType: "image/jpeg")
        #expect(prepared.data == notAnImage)
        #expect(!prepared.wasDownscaled)
        #expect(prepared.capturedLatitude == nil)
    }
}
