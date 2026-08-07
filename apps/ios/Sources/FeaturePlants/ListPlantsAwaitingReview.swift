import CoreDomain
import CoreNetworking

/// The plants whose suggestion is waiting for a person.
///
/// Assembled on the client rather than asked for as a query, because the
/// contract has no "awaiting review" list: a plant is unidentified until an
/// explicit `ConfirmPlantIdentification` (ADR-0015), and whether a suggestion
/// exists for it is a second read per plant. So this asks for the unidentified
/// plants and then, for each, whether there is something to answer.
///
/// The per-plant fan-out is bounded by what it is for: a walk's worth of new
/// plants, not a garden's history. Plants with no suggestion drop out silently
/// — they are ordinary unidentified plants, not failures.
public struct ListPlantsAwaitingReview: Sendable {
    private let searchPlants: SearchPlants
    private let fetchIdentification: FetchPlantIdentification

    public init(searchPlants: SearchPlants, fetchIdentification: FetchPlantIdentification) {
        self.searchPlants = searchPlants
        self.fetchIdentification = fetchIdentification
    }

    public func callAsFunction(gardenId: String) async throws -> [IdentificationReviewItem] {
        let plants = try await searchPlants(
            gardenId: gardenId,
            query: nil,
            status: nil,
            identified: false,
            filters: PlantSearchFilters(),
            cursor: nil,
            limit: nil
        ).items

        var items: [IdentificationReviewItem] = []
        for plant in plants {
            // A failure for one plant drops that plant rather than the stack:
            // fourteen answerable cards are worth more than an error screen.
            guard
                let identification = try? await fetchIdentification(
                    gardenId: gardenId,
                    plantId: plant.id
                )
            else { continue }

            items.append(
                IdentificationReviewItem(
                    plantId: plant.id,
                    identificationId: identification.id,
                    plantRevision: plant.revision,
                    suggestedName: identification.suggestedCommonName
                        ?? identification.suggestedScientificName,
                    confidence: identification.confidenceScore,
                    photoMediaId: nil,
                    capturedAt: identification.createdAt
                )
            )
        }
        return items
    }
}
