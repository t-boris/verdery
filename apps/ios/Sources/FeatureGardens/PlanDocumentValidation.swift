import Foundation

/// Local pre-upload safety validation for a property-plan document
/// (P6-PLAN iOS parity) — the same checks the web's `GardenPlanUpload` runs
/// before any byte uploads, mirroring the worker's own `imported_plan`
/// validation policy (`services/workers/.../validation-policy.ts`) for fast
/// feedback; the worker stays authoritative byte-level.
public enum PlanDocumentValidation {
    /// Section 8.1's accepted `imported_plan` types: the raster image types
    /// plus PDF.
    public static let acceptedContentTypes: Set<String> = [
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/heic",
        "image/heif",
        "application/pdf",
    ]

    /// The worker policy's own `imported_plan` ceiling (50 MiB).
    public static let maximumByteCount = 50 * 1024 * 1024

    public static let pdfContentType = "application/pdf"

    public enum Issue: Equatable, Sendable {
        case unsupportedType
        case tooLarge
    }

    /// `nil` when the document passes local validation.
    public static func validate(contentType: String, byteCount: Int) -> Issue? {
        guard acceptedContentTypes.contains(contentType.lowercased()) else {
            return .unsupportedType
        }
        guard byteCount <= maximumByteCount else {
            return .tooLarge
        }
        return nil
    }

    /// "50 MiB" — the limit as user text, matching the web's byte
    /// formatting for the same figure.
    public static var maximumSizeText: String {
        "\(maximumByteCount / (1024 * 1024)) MiB"
    }
}
