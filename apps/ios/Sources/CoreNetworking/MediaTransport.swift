import CoreDomain
import Foundation

/// Wire shapes of the media operations. See `PlantTransport.swift`'s doc
/// comment for why these types code by straight synthesis — `MediaClass`,
/// `MediaUploadState`, `MediaProcessingState`, and
/// `MediaSensitivityClassification` already carry the contract's exact wire
/// raw values (`CoreDomain.MediaClass`'s own doc comment), so they decode
/// directly with no separate transport-only enum.
///
/// Source: packages/api-contracts/openapi.yaml, tag `Media`.
struct MediaTransport: Codable {
    let id: String
    let gardenId: String
    let uploadedByProfileId: String
    let mediaClass: MediaClass
    let displayFilename: String
    let declaredContentType: String
    let verifiedContentType: String?
    let declaredByteSize: Int64
    let verifiedByteSize: Int64?
    let checksumSha256: String?
    let uploadState: MediaUploadState
    let processingState: MediaProcessingState?
    let sensitivityClassification: MediaSensitivityClassification
    let revision: Int
    let createdAt: Date
    let updatedAt: Date

    var domainValue: Media {
        Media(
            id: id,
            gardenId: gardenId,
            uploadedByProfileId: uploadedByProfileId,
            mediaClass: mediaClass,
            displayFilename: displayFilename,
            declaredContentType: declaredContentType,
            verifiedContentType: verifiedContentType,
            declaredByteSize: declaredByteSize,
            verifiedByteSize: verifiedByteSize,
            checksumSha256: checksumSha256,
            uploadState: uploadState,
            processingState: processingState,
            sensitivityClassification: sensitivityClassification,
            revision: revision,
            createdAt: createdAt,
            updatedAt: updatedAt
        )
    }
}

struct MediaUploadSessionTransport: Decodable {
    let media: MediaTransport
    let uploadUrl: URL
    let uploadUrlExpiresAt: Date

    var domainValue: MediaUploadSession {
        MediaUploadSession(media: media.domainValue, uploadUrl: uploadUrl, uploadUrlExpiresAt: uploadUrlExpiresAt)
    }
}

struct MediaAccessTransport: Decodable {
    let url: URL
    let expiresAt: Date

    var domainValue: MediaAccess {
        MediaAccess(url: url, expiresAt: expiresAt)
    }
}

struct RegisterMediaUploadRequestTransport: Encodable {
    let mediaClass: MediaClass
    let displayFilename: String
    let declaredContentType: String
    let declaredByteSize: Int64
    let checksumSha256: String?
}
