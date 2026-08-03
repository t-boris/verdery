import Foundation

/// One photograph in a plant's journal sequence (P11-MEDIA-01).
///
/// NOT A FRAME OF A GENERATED VIDEO. The sequence is the photographs that
/// already exist, in observed order; nothing is rendered, on the server or
/// here. That is a deliberate scope decision recorded in
/// `ListPlantJournalFrames` on the server side, repeated here because a
/// reader meeting the word "frame" first in this file would otherwise assume
/// a time-lapse exists.
///
/// Carries `observationId` so a comparison view can lead back to the record a
/// frame came from, and `purpose` so consecutive frames can be narrowed to
/// shots that are actually comparable. `purpose` is nil for a photograph
/// attached without a label; those appear only in an unnarrowed sequence.
///
/// Source: packages/api-contracts/openapi.yaml, schema `PlantJournalFrame`.
public struct PlantJournalFrame: Equatable, Sendable, Identifiable {
    public let observationId: String
    public let mediaId: String
    public let observedAt: Date
    public let purpose: ObservationPhotoPurpose?

    /// The media id: unique within a sequence, where an observation id is not — one observation can contribute several frames.
    public var id: String { mediaId }

    public init(
        observationId: String,
        mediaId: String,
        observedAt: Date,
        purpose: ObservationPhotoPurpose?
    ) {
        self.observationId = observationId
        self.mediaId = mediaId
        self.observedAt = observedAt
        self.purpose = purpose
    }
}
