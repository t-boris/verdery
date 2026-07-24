import Foundation

/// The kind of media a record represents — determines quota bucket, storage
/// bucket, retention policy, and validation profile server-side.
///
/// Source: architecture/media-storage-and-processing.md, section "3. Media
/// Classes"; packages/api-contracts/openapi.yaml, `MediaClass`.
public enum MediaClass: String, Equatable, Sendable, CaseIterable, Codable {
    case gardenPhoto = "garden_photo"
    case importedPlan = "imported_plan"
    case rawCapture = "raw_capture"
    case derivedPreview = "derived_preview"
    case processingOutput = "processing_output"
    case exportPackage = "export_package"
}
