import Foundation

/// `RegisterMediaUpload`'s response: the newly `authorized` media record plus
/// the backend-authorized resumable upload session the client uploads
/// directly to — never through the interactive API (architecture/media-
/// storage-and-processing.md, section "2. Principles": "Binary media bypasses
/// the interactive API data path").
///
/// Source: packages/api-contracts/openapi.yaml, `MediaUploadSession`.
public struct MediaUploadSession: Equatable, Sendable {
    public let media: Media
    /// Resumable upload session URI. The client issues its own `PUT`
    /// requests here directly, following Cloud Storage's resumable upload
    /// protocol (`Content-Range`-addressed chunks, or one `PUT` covering the
    /// whole declared byte range).
    public let uploadUrl: URL
    public let uploadUrlExpiresAt: Date

    public init(media: Media, uploadUrl: URL, uploadUrlExpiresAt: Date) {
        self.media = media
        self.uploadUrl = uploadUrl
        self.uploadUrlExpiresAt = uploadUrlExpiresAt
    }
}

/// `GetMediaAccess`'s response: a short-lived signed download URL. Never a
/// permanent one.
///
/// Source: packages/api-contracts/openapi.yaml, `MediaAccess`.
public struct MediaAccess: Equatable, Sendable {
    public let url: URL
    public let expiresAt: Date

    public init(url: URL, expiresAt: Date) {
        self.url = url
        self.expiresAt = expiresAt
    }
}
