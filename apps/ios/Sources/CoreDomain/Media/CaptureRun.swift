import Foundation

/// One photograph taken during a walk, and what has become of it.
public struct CapturedShot: Sendable, Equatable, Identifiable {
    public enum Stage: Sendable, Equatable {
        /// Written to disk and queued. The only stage that needs no network,
        /// and the one every shot reaches before the shutter sound ends.
        case saved
        /// The bytes are on their way.
        case uploading
        /// The server has them, and identification has been asked for.
        case identifying
        /// A suggestion came back and is waiting for a person.
        case awaitingReview
        /// Somebody answered — confirmed a species, or said it is unknown.
        case resolved
        /// Something went wrong that retrying will not fix on its own.
        case failed(reasonCode: String)
    }

    /// The plant this shot created, minted on the device at the shutter.
    public let plantId: String
    public let capturedAt: Date
    public var stage: Stage
    /// Where the phone was, if it knew — see `PlacementProposal`.
    public var proposedMapObjectId: String?

    public var id: String { plantId }

    public init(
        plantId: String,
        capturedAt: Date,
        stage: Stage = .saved,
        proposedMapObjectId: String? = nil
    ) {
        self.plantId = plantId
        self.capturedAt = capturedAt
        self.stage = stage
        self.proposedMapObjectId = proposedMapObjectId
    }
}

/// A walk through the garden, counted.
///
/// The unit the capture surface works in: a person photographs eleven plants
/// down one bed without returning to a list between shots, and this is what
/// they have afterwards. It exists as a value type, separate from any camera,
/// so the thing that decides what a run *means* can be tested without one.
///
/// Nothing here waits on a network. Every shot is `saved` the instant it is
/// taken, and every later stage is an enrichment that may arrive minutes or a
/// day afterwards.
public struct CaptureRun: Sendable, Equatable {
    public private(set) var shots: [CapturedShot]

    public init(shots: [CapturedShot] = []) {
        self.shots = shots
    }

    public var isEmpty: Bool { shots.isEmpty }
    public var count: Int { shots.count }

    public mutating func record(_ shot: CapturedShot) {
        shots.append(shot)
    }

    public mutating func update(plantId: String, to stage: CapturedShot.Stage) {
        guard let index = shots.firstIndex(where: { $0.plantId == plantId }) else { return }
        shots[index].stage = stage
    }

    /// The shots a person still has to answer for, oldest first.
    ///
    /// Oldest first because that is the order they were seen in, and a walk
    /// reviewed in capture order is a walk somebody can still remember.
    public var awaitingReview: [CapturedShot] {
        shots.filter { $0.stage == .awaitingReview }.sorted { $0.capturedAt < $1.capturedAt }
    }

    /// What to tell somebody when they finish a run.
    ///
    /// Deliberately four separate numbers rather than a percentage: "12
    /// photos, 9 identified, 3 need you, 4 still uploading" answers both
    /// questions a person has — is my work safe, and what is left for me —
    /// and a single progress figure answers neither.
    public struct Summary: Sendable, Equatable {
        public let captured: Int
        public let resolved: Int
        public let awaitingReview: Int
        public let stillUploading: Int
        public let failed: Int

        /// True when nothing is left for the person or the network.
        public var isComplete: Bool {
            awaitingReview == 0 && stillUploading == 0 && failed == 0
        }
    }

    public var summary: Summary {
        var resolved = 0
        var awaiting = 0
        var uploading = 0
        var failed = 0

        for shot in shots {
            switch shot.stage {
            case .resolved: resolved += 1
            case .awaitingReview: awaiting += 1
            case .saved, .uploading, .identifying: uploading += 1
            case .failed: failed += 1
            }
        }

        return Summary(
            captured: shots.count,
            resolved: resolved,
            awaitingReview: awaiting,
            stillUploading: uploading,
            failed: failed
        )
    }
}
