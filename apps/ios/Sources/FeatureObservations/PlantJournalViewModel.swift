import CoreDomain
import CoreLocalization
import CoreNetworking
import Foundation
import Observation

/// One journal frame with the signed URL it currently displays at.
public struct PlantJournalDisplayFrame: Identifiable, Sendable {
    public let frame: PlantJournalFrame
    public let url: URL

    public var id: String { frame.mediaId }
}

/// A plant's photographs as an ordered sequence, for reading growth by
/// comparing one frame against another (P11-MEDIA-01).
///
/// NOT A TIME-LAPSE, and nothing here renders one. The frames are the
/// photographs that already exist; `ListPlantJournalFrames` on the server says
/// the same in its own header. Without that note a later reader takes this
/// screen for an unfinished player.
///
/// Narrowing to one shot purpose is the substance rather than a convenience: a
/// sequence mixing whole-plant shots with leaf close-ups compares nothing. The
/// unnarrowed default is deliberately the mixture — it is the only setting
/// that includes photographs carrying no purpose label at all, and hiding
/// those would make an older plant's history look empty.
///
/// Resolving each frame's signed URL mirrors `FeaturePlants`'
/// `PlantPhotoGalleryController` exactly, including its posture on failure: a
/// frame whose URL cannot be resolved is dropped rather than failing the whole
/// sequence, because one expired signature should not hide a decade of
/// photographs.
@MainActor
@Observable
public final class PlantJournalViewModel {
    public private(set) var frames: [PlantJournalDisplayFrame] = []
    public private(set) var isLoading = false
    public private(set) var didLoad = false

    /// The shot purpose the sequence is narrowed to; `nil` is every
    /// photograph, labelled or not.
    public var purpose: ObservationPhotoPurpose? {
        didSet {
            guard purpose != oldValue else { return }
            Task { await load() }
        }
    }

    private let gardenId: String
    private let plantId: String
    private let listPlantJournalFrames: ListPlantJournalFrames
    private let mediaGateway: any MediaGateway
    private let strings: LocalizedStrings

    public init(
        gardenId: String,
        plantId: String,
        listPlantJournalFrames: ListPlantJournalFrames,
        mediaGateway: any MediaGateway,
        strings: LocalizedStrings
    ) {
        self.gardenId = gardenId
        self.plantId = plantId
        self.listPlantJournalFrames = listPlantJournalFrames
        self.mediaGateway = mediaGateway
        self.strings = strings
    }

    public var title: String { strings(.observationsJournalTitle) }
    public var purposeFilterLabel: String { strings(.observationsJournalPurposeFilterLabel) }
    public var allPurposesTitle: String { strings(.observationsJournalAllPurposes) }
    /// Two empty states, because they are different situations: a plant with no
    /// photographs at all, and a filter that matches none of the ones it has.
    /// The second is something the reader can undo.
    public var emptyMessage: String {
        purpose == nil
            ? strings(.observationsJournalEmpty)
            : strings(.observationsJournalEmptyForPurpose)
    }

    public func purposeName(_ purpose: ObservationPhotoPurpose) -> String {
        ObservationsLocalization.photoPurposeName(purpose, strings: strings)
    }

    public func frameLabel(_ frame: PlantJournalFrame) -> String {
        let observed = ObservationsLocalization.formattedObservedAt(frame.observedAt)
        guard let purpose = frame.purpose else { return observed }
        return "\(purposeName(purpose)) — \(observed)"
    }

    public func load() async {
        isLoading = true
        defer {
            isLoading = false
            didLoad = true
        }

        guard
            let sequence = try? await listPlantJournalFrames(
                gardenId: gardenId,
                plantId: plantId,
                purpose: purpose
            )
        else {
            frames = []
            return
        }

        var resolved: [PlantJournalDisplayFrame] = []
        for frame in sequence {
            guard
                let access = try? await mediaGateway.getMediaAccess(
                    gardenId: gardenId, mediaId: frame.mediaId
                )
            else { continue }
            resolved.append(PlantJournalDisplayFrame(frame: frame, url: access.url))
        }
        frames = resolved
    }
}
