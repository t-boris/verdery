import Foundation

/// One photograph being attached to an observation: which media, and which of
/// the journal's shot purposes it fills (P11-MEDIA-01).
///
/// The purpose travels with the media id rather than being defaulted at the
/// wire boundary. A label chosen for the photographer is worse than no label:
/// it lands the shot in a comparison sequence it does not belong to, and
/// nothing downstream can tell it was guessed.
///
/// Source: packages/api-contracts/openapi.yaml, schema
/// `ObservationPhotoAttachmentRequest`.
public struct ObservationPhotoAttachment: Equatable, Sendable {
    public let mediaId: String
    public let purpose: ObservationPhotoPurpose

    public init(mediaId: String, purpose: ObservationPhotoPurpose) {
        self.mediaId = mediaId
        self.purpose = purpose
    }
}
