import Foundation

/// Section 6's server-owned upload state machine, one column, revisioned.
///
/// Source: architecture/media-storage-and-processing.md, section "6. Upload
/// State Machine"; packages/api-contracts/openapi.yaml, `MediaUploadState`.
public enum MediaUploadState: String, Equatable, Sendable, CaseIterable, Codable {
    case registered
    case authorized
    case uploading
    case verifying
    case rejected
    case available
    case deletionScheduled = "deletion_scheduled"
    case deleted
}

/// Orthogonal to `MediaUploadState` — populated once an async derivative/
/// validation worker has run. `nil` means processing has not started, or
/// does not apply to this media class.
///
/// Source: architecture/media-storage-and-processing.md, section "9. Image
/// Derivatives"; packages/api-contracts/openapi.yaml, `MediaProcessingState`.
public enum MediaProcessingState: String, Equatable, Sendable, CaseIterable, Codable {
    case processing
    case processed
    case processingFailed = "processing_failed"
}

/// Derived from `mediaClass` at registration, never client-supplied.
///
/// Source: packages/api-contracts/openapi.yaml, `MediaSensitivityClassification`.
public enum MediaSensitivityClassification: String, Equatable, Sendable, CaseIterable, Codable {
    case standard
    case sensitive
    case restricted
}

/// A server-authoritative media record — what `GetMediaStatus`/
/// `CompleteMediaUpload`/`RegisterMediaUpload` all return the same shape of.
///
/// Source: architecture/media-storage-and-processing.md, section "5. Media
/// Record"; packages/api-contracts/openapi.yaml, `Media`.
public struct Media: Equatable, Sendable, Identifiable, Codable {
    public let id: String
    public let gardenId: String
    public let uploadedByProfileId: String
    public let mediaClass: MediaClass
    public let displayFilename: String
    public let declaredContentType: String
    /// Set once `CompleteMediaUpload` reads real object metadata. `nil` until then.
    public let verifiedContentType: String?
    public let declaredByteSize: Int64
    /// Set once `CompleteMediaUpload` reads real object metadata. `nil` until then.
    public let verifiedByteSize: Int64?
    /// The client's own declared checksum, when supplied at registration;
    /// `nil` otherwise. Never independently confirmed against the object's
    /// real bytes at the `CompleteMediaUpload` stage.
    public let checksumSha256: String?
    public let uploadState: MediaUploadState
    public let processingState: MediaProcessingState?
    public let sensitivityClassification: MediaSensitivityClassification
    public let revision: Int
    public let createdAt: Date
    public let updatedAt: Date

    public init(
        id: String,
        gardenId: String,
        uploadedByProfileId: String,
        mediaClass: MediaClass,
        displayFilename: String,
        declaredContentType: String,
        verifiedContentType: String?,
        declaredByteSize: Int64,
        verifiedByteSize: Int64?,
        checksumSha256: String?,
        uploadState: MediaUploadState,
        processingState: MediaProcessingState?,
        sensitivityClassification: MediaSensitivityClassification,
        revision: Int,
        createdAt: Date,
        updatedAt: Date
    ) {
        self.id = id
        self.gardenId = gardenId
        self.uploadedByProfileId = uploadedByProfileId
        self.mediaClass = mediaClass
        self.displayFilename = displayFilename
        self.declaredContentType = declaredContentType
        self.verifiedContentType = verifiedContentType
        self.declaredByteSize = declaredByteSize
        self.verifiedByteSize = verifiedByteSize
        self.checksumSha256 = checksumSha256
        self.uploadState = uploadState
        self.processingState = processingState
        self.sensitivityClassification = sensitivityClassification
        self.revision = revision
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }
}
