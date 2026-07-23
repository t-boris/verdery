import CoreDomain

/// Fallback used only when the on-disk database cannot be opened — mirrors
/// `FeatureGardens.InMemoryGardenStore`/`FeaturePlants.InMemoryPlantStore`'s
/// identical reasoning and scope.
///
/// Simpler than either of those: there is no `save(_:)`/`replaceAll(with:)`
/// method to guard here, because nothing ever overwrites an observation row
/// in place (see `LocalObservationStore`'s own doc comment) — an append-only
/// store has no "pending mutation a stale server response could clobber" to
/// protect against.
public actor InMemoryObservationStore: LocalObservationStore {
    private var observationsByGardenId: [String: [GardenObservation]] = [:]

    public init() {}

    public func fetchPending(gardenId: String) async throws -> [GardenObservation] {
        observationsByGardenId[gardenId] ?? []
    }

    @discardableResult
    public func commitOfflineAppend(_ observation: GardenObservation, operation: OutboxOperation) async throws -> GardenObservation {
        observationsByGardenId[observation.gardenId, default: []].append(observation)
        return observation
    }

    public func markSynced(observationId: String) async throws {
        for (gardenId, observations) in observationsByGardenId {
            observationsByGardenId[gardenId] = observations.filter { $0.id != observationId }
        }
    }

    public func removeAll(gardenId: String) async throws {
        observationsByGardenId[gardenId] = nil
    }
}
