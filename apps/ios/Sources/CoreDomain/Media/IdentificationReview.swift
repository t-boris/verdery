import Foundation

/// One plant waiting for somebody to answer for it.
///
/// Assembled from a plant and the suggestion that came back for it, so the
/// stack can be reasoned about — and tested — without a network, a camera, or
/// a view.
public struct IdentificationReviewItem: Sendable, Equatable, Identifiable {
    public let plantId: String
    public let identificationId: String
    /// The revision the confirm command will quote. Carried rather than
    /// re-fetched, because the whole point of the stack is that fifteen
    /// answers cost fifteen commands and not thirty round trips.
    public let plantRevision: Int
    public let suggestedName: String?
    /// 0…1 as the provider reported it. Rendered as a bar **and** a number:
    /// the bar is read at a glance and the number is what a person quotes back
    /// when the suggestion is wrong.
    public let confidence: Double
    public let photoMediaId: String?
    public let capturedAt: Date

    public init(
        plantId: String,
        identificationId: String,
        plantRevision: Int,
        suggestedName: String?,
        confidence: Double,
        photoMediaId: String?,
        capturedAt: Date
    ) {
        self.plantId = plantId
        self.identificationId = identificationId
        self.plantRevision = plantRevision
        self.suggestedName = suggestedName
        self.confidence = confidence
        self.photoMediaId = photoMediaId
        self.capturedAt = capturedAt
    }

    public var id: String { plantId }

    /// There is a name to accept. A suggestion with none is a card that can
    /// only be skipped, and the screen must not offer "confirm" for it.
    public var isConfirmable: Bool {
        suggestedName?.isEmpty == false
    }
}

/// What a person did with one card.
public enum IdentificationReviewAnswer: Sendable, Equatable {
    /// Accept the suggestion. Becomes an explicit `ConfirmPlantIdentification`
    /// — ADR-0015 holds exactly: nothing auto-confirms, and a swipe is a
    /// decision a person made, not an absence of one.
    case confirm
    /// Not this. The plant stays unidentified with its photograph as its
    /// identity, which is a complete and useful record.
    case skip
    /// Open the whole plant. Leaves the card unanswered on purpose: going to
    /// look at something is not deciding about it.
    case open
}

/// One command the stack decided to send.
public struct IdentificationReviewCommand: Sendable, Equatable {
    public let plantId: String
    public let identificationId: String
    public let expectedRevision: Int

    public init(plantId: String, identificationId: String, expectedRevision: Int) {
        self.plantId = plantId
        self.identificationId = identificationId
        self.expectedRevision = expectedRevision
    }
}

/// Reducing a sequence of answers to the commands it means.
///
/// Pure, and separated from any view, because the property that matters here is
/// arithmetic rather than visual: fifteen photographs answered in one sitting
/// must produce exactly one confirm per accepted suggestion, none for a skip,
/// and none at all for a card somebody merely opened.
public enum IdentificationReviews {
    /// The commands a run of answers produces, in the order they were given.
    ///
    /// A skip sends nothing. That is deliberate and is the difference between
    /// this and a wizard: declining a suggestion is not a server fact, it is
    /// the absence of one, and the plant already exists with its photograph.
    public static func commands(
        for items: [IdentificationReviewItem],
        answers: [String: IdentificationReviewAnswer]
    ) -> [IdentificationReviewCommand] {
        items.compactMap { item in
            guard answers[item.plantId] == .confirm, item.isConfirmable else { return nil }
            return IdentificationReviewCommand(
                plantId: item.plantId,
                identificationId: item.identificationId,
                expectedRevision: item.plantRevision
            )
        }
    }

    /// What is left after these answers — the counter on the screen.
    ///
    /// An opened card still counts as remaining, because opening is not
    /// answering and a counter that pretended otherwise would tell somebody
    /// they were finished when they were not.
    public static func remaining(
        in items: [IdentificationReviewItem],
        answers: [String: IdentificationReviewAnswer]
    ) -> [IdentificationReviewItem] {
        items.filter { item in
            switch answers[item.plantId] {
            case .confirm, .skip: false
            case .open, nil: true
            }
        }
    }
}
