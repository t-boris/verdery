import CoreDomain
import CoreNetworking
import Foundation

/// In-memory, non-networked stand-in for the real API — the same role
/// `FakeMapGateway` plays for `FeatureMap`'s own view-model tests. Enforces
/// the same revision-guarded semantics real mutating operations carry, so a
/// test can tell a correct optimistic-concurrency handling from a broken one.
final class FakePlantGateway: PlantGateway, @unchecked Sendable {
    private var plants: [String: Plant]
    var taxonomyResults: [TaxonomyReference] = []
    var taxonProfileResult: Result<TaxonProfile, Error> = .failure(CancellationError())
    var searchQueries: [String?] = []
    /// Set by a test to make `attachPlantPhoto` fail instead of succeeding
    /// — `AttachPlantPhotoTests`'s own "propagates a gateway failure" case.
    var attachPlantPhotoError: Error?
    /// Set by a test to make `addPlantFromPhoto` fail instead of succeeding
    /// — `AddPlantFromPhotoTests`'s own "propagates a gateway failure" case.
    var addPlantFromPhotoError: Error?
    /// `getPlantIdentification`'s scriptable result: `nil` (the default)
    /// throws the same `plants_inventory.plant.identification_not_found`
    /// `404` a real "nothing pending" answer would, matching
    /// `FetchPlantIdentification`'s own doc comment on that shape.
    var pendingIdentification: PlantIdentification?
    /// Overrides `getPlantIdentification`'s error entirely, for a test that
    /// needs a failure OTHER than the standard not-found — e.g. a transport
    /// failure `FetchPlantIdentification` must let propagate, not swallow.
    var getPlantIdentificationError: Error?
    /// `searchPlants`'s scriptable result — one page at a time, keyed by
    /// whatever `cursor` the test expects to see requested next; `nil`
    /// entries answer with an empty, terminal page.
    var searchPlantsPages: [String?: PlantSearchPage] = [:]
    var searchPlantsQueries: [
        (
            query: String?, status: [PlantStatus]?, identified: Bool?,
            filters: PlantSearchFilters, cursor: String?
        )
    ] = []
    var searchPlantsError: Error?
    var plantPhotos: [PlantPhoto] = []
    var listPlantPhotosError: Error?
    var recordedObservation = GardenObservation(
        id: "observation-1", gardenId: "garden-1", plantId: "plant-1", gardenObjectId: nil,
        actorType: .user, createdByProfileId: "profile-1", noteText: nil, conditionSummary: "Leaves look healthy",
        correctionKind: nil, correctsObservationId: nil, isCorrected: false,
        observedAt: Date(timeIntervalSince1970: 0), recordedAt: Date(timeIntervalSince1970: 0), photos: []
    )
    var recordObservationFromIdentificationError: Error?
    private(set) var recordObservationFromIdentificationCalls: [(plantId: String, identificationId: String)] = []

    init(plants: [Plant] = []) {
        self.plants = Dictionary(uniqueKeysWithValues: plants.map { ($0.id, $0) })
    }

    func addPlant(
        gardenId: String,
        displayName: String,
        taxonomyReferenceId: String?,
        varietyLabel: String?,
        acquisitionDate: String?,
        acquisitionDateType: PlantAcquisitionDateType?,
        groupingKind: PlantGroupingKind,
        quantity: Int?,
        gardenAreaMapObjectId: String?,
        placementMapObjectId: String?,
        lifecycleStage: PlantLifecycleStage?,
        idempotencyKey: String
    ) async throws -> Plant {
        let plant = Plant(
            id: "plant-\(plants.count + 1)",
            gardenId: gardenId,
            gardenAreaMapObjectId: gardenAreaMapObjectId,
            placementMapObjectId: placementMapObjectId,
            displayName: displayName,
            taxonomyReferenceId: taxonomyReferenceId,
            varietyLabel: varietyLabel,
            acceptedIdentificationId: nil,
            acquisitionDate: acquisitionDate,
            acquisitionDateType: acquisitionDateType,
            groupingKind: groupingKind,
            quantity: quantity,
            lifecycleStage: .planned,
            status: .active,
            conditionNote: nil,
            careGuidanceNote: nil,
            revision: 1,
            createdByProfileId: "profile-1",
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0)
        )
        plants[plant.id] = plant
        return plant
    }

    func addPlantFromPhoto(
        gardenId: String,
        photoMediaId: String,
        gardenAreaMapObjectId: String?,
        placementMapObjectId: String?,
        idempotencyKey: String
    ) async throws -> Plant {
        if let addPlantFromPhotoError { throw addPlantFromPhotoError }
        return try await addPlant(
            gardenId: gardenId,
            displayName: "From photo",
            taxonomyReferenceId: nil,
            varietyLabel: nil,
            acquisitionDate: nil,
            acquisitionDateType: nil,
            groupingKind: .individual,
            quantity: nil,
            gardenAreaMapObjectId: gardenAreaMapObjectId,
            placementMapObjectId: placementMapObjectId,
            lifecycleStage: nil,
            idempotencyKey: idempotencyKey
        )
    }

    func getPlant(gardenId: String, plantId: String) async throws -> Plant {
        guard let plant = plants[plantId] else {
            throw APIGatewayError.unexpectedStatus(404, correlationId: "fake-missing-plant")
        }
        return plant
    }

    func updatePlantDetails(
        gardenId: String,
        plantId: String,
        displayName: String?,
        taxonomyReferenceId: FieldUpdate<String>,
        varietyLabel: FieldUpdate<String>,
        acquisitionDate: FieldUpdate<String>,
        acquisitionDateType: FieldUpdate<PlantAcquisitionDateType>,
        conditionNote: FieldUpdate<String>,
        careGuidanceNote: FieldUpdate<String>,
        quantity: FieldUpdate<Int>,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> Plant {
        let plant = try expectRevision(plantId, expectedRevision)

        let updated = Plant(
            id: plant.id,
            gardenId: plant.gardenId,
            gardenAreaMapObjectId: plant.gardenAreaMapObjectId,
            placementMapObjectId: plant.placementMapObjectId,
            displayName: displayName ?? plant.displayName,
            taxonomyReferenceId: resolved(taxonomyReferenceId, current: plant.taxonomyReferenceId),
            varietyLabel: resolved(varietyLabel, current: plant.varietyLabel),
            acceptedIdentificationId: plant.acceptedIdentificationId,
            acquisitionDate: resolved(acquisitionDate, current: plant.acquisitionDate),
            acquisitionDateType: resolved(acquisitionDateType, current: plant.acquisitionDateType),
            groupingKind: plant.groupingKind,
            quantity: resolved(quantity, current: plant.quantity),
            lifecycleStage: plant.lifecycleStage,
            status: plant.status,
            conditionNote: resolved(conditionNote, current: plant.conditionNote),
            careGuidanceNote: resolved(careGuidanceNote, current: plant.careGuidanceNote),
            revision: plant.revision + 1,
            createdByProfileId: plant.createdByProfileId,
            createdAt: plant.createdAt,
            updatedAt: plant.updatedAt
        )
        plants[plant.id] = updated
        return updated
    }

    func attachPlantPhoto(
        gardenId: String,
        plantId: String,
        mediaId: String,
        isPrimary: Bool?,
        idempotencyKey: String
    ) async throws -> PlantPhoto {
        if let attachPlantPhotoError { throw attachPlantPhotoError }
        return PlantPhoto(id: "photo-1", plantId: plantId, mediaId: mediaId, isPrimary: isPrimary ?? false, createdAt: Date(timeIntervalSince1970: 0))
    }

    func setPrimaryPlantPhoto(
        gardenId: String,
        plantId: String,
        plantPhotoId: String,
        idempotencyKey: String
    ) async throws -> PlantPhoto {
        PlantPhoto(id: plantPhotoId, plantId: plantId, mediaId: "media-1", isPrimary: true, createdAt: Date(timeIntervalSince1970: 0))
    }

    func confirmPlantIdentification(
        gardenId: String,
        plantId: String,
        identificationId: String,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> Plant {
        let plant = try expectRevision(plantId, expectedRevision)
        let updated = Plant(
            id: plant.id, gardenId: plant.gardenId, gardenAreaMapObjectId: plant.gardenAreaMapObjectId,
            placementMapObjectId: plant.placementMapObjectId, displayName: plant.displayName,
            taxonomyReferenceId: plant.taxonomyReferenceId, varietyLabel: plant.varietyLabel,
            acceptedIdentificationId: identificationId, acquisitionDate: plant.acquisitionDate,
            acquisitionDateType: plant.acquisitionDateType, groupingKind: plant.groupingKind, quantity: plant.quantity,
            lifecycleStage: plant.lifecycleStage, status: plant.status, conditionNote: plant.conditionNote,
            careGuidanceNote: plant.careGuidanceNote, revision: plant.revision + 1,
            createdByProfileId: plant.createdByProfileId, createdAt: plant.createdAt, updatedAt: plant.updatedAt
        )
        plants[plant.id] = updated
        return updated
    }

    func getPlantIdentification(gardenId: String, plantId: String) async throws -> PlantIdentification {
        if let getPlantIdentificationError { throw getPlantIdentificationError }
        guard let pendingIdentification else {
            throw APIGatewayError.service(
                APIErrorBody(
                    code: "plants_inventory.plant.identification_not_found",
                    message: "fake",
                    correlationId: "fake",
                    retryable: false
                ),
                statusCode: 404,
                retryAfterSeconds: nil
            )
        }
        return pendingIdentification
    }

    func recordObservationFromIdentification(
        gardenId: String,
        plantId: String,
        identificationId: String,
        idempotencyKey: String
    ) async throws -> GardenObservation {
        if let recordObservationFromIdentificationError { throw recordObservationFromIdentificationError }
        recordObservationFromIdentificationCalls.append((plantId: plantId, identificationId: identificationId))
        return recordedObservation
    }

    func transitionLifecycleStage(
        gardenId: String,
        plantId: String,
        stage: PlantLifecycleStage,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> Plant {
        let plant = try expectRevision(plantId, expectedRevision)
        let updated = withLifecycleStage(plant, stage)
        plants[plant.id] = updated
        return updated
    }

    func setStatus(
        gardenId: String,
        plantId: String,
        status: PlantStatus,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> Plant {
        let plant = try expectRevision(plantId, expectedRevision)
        let updated = withStatus(plant, status)
        plants[plant.id] = updated
        return updated
    }

    func movePlant(
        gardenId: String,
        plantId: String,
        gardenAreaMapObjectId: String?,
        placementMapObjectId: String?,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> Plant {
        let plant = try expectRevision(plantId, expectedRevision)
        let updated = Plant(
            id: plant.id,
            gardenId: plant.gardenId,
            gardenAreaMapObjectId: gardenAreaMapObjectId ?? plant.gardenAreaMapObjectId,
            placementMapObjectId: placementMapObjectId ?? plant.placementMapObjectId,
            displayName: plant.displayName,
            taxonomyReferenceId: plant.taxonomyReferenceId,
            varietyLabel: plant.varietyLabel,
            acceptedIdentificationId: plant.acceptedIdentificationId,
            acquisitionDate: plant.acquisitionDate,
            acquisitionDateType: plant.acquisitionDateType,
            groupingKind: plant.groupingKind,
            quantity: plant.quantity,
            lifecycleStage: plant.lifecycleStage,
            status: plant.status,
            conditionNote: plant.conditionNote,
            careGuidanceNote: plant.careGuidanceNote,
            revision: plant.revision + 1,
            createdByProfileId: plant.createdByProfileId,
            createdAt: plant.createdAt,
            updatedAt: plant.updatedAt
        )
        plants[plant.id] = updated
        return updated
    }

    func searchTaxonomyReferences(gardenId: String, query: String?, limit: Int?) async throws -> [TaxonomyReference] {
        searchQueries.append(query)
        return taxonomyResults
    }

    func getTaxonProfile(taxonomyReferenceId: String) async throws -> TaxonProfile {
        try taxonProfileResult.get()
    }

    func searchPlants(
        gardenId: String, query: String?, status: [PlantStatus]?, identified: Bool?,
        filters: PlantSearchFilters, cursor: String?, limit: Int?
    ) async throws -> PlantSearchPage {
        if let searchPlantsError { throw searchPlantsError }
        searchPlantsQueries.append(
            (query: query, status: status, identified: identified, filters: filters, cursor: cursor)
        )
        return searchPlantsPages[cursor] ?? PlantSearchPage(items: [], nextCursor: nil)
    }

    func listPlantPhotos(gardenId: String, plantId: String) async throws -> [PlantPhoto] {
        if let listPlantPhotosError { throw listPlantPhotosError }
        return plantPhotos
    }

    private func resolved<Value>(_ fieldUpdate: FieldUpdate<Value>, current: Value?) -> Value? {
        switch fieldUpdate {
        case .unchanged: current
        case let .set(value): value
        }
    }

    private func expectRevision(_ plantId: String, _ expected: Int) throws -> Plant {
        guard let plant = plants[plantId], plant.revision == expected else {
            throw APIGatewayError.unexpectedStatus(409, correlationId: "fake-conflict")
        }
        return plant
    }

    private func withLifecycleStage(_ plant: Plant, _ stage: PlantLifecycleStage) -> Plant {
        Plant(
            id: plant.id, gardenId: plant.gardenId, gardenAreaMapObjectId: plant.gardenAreaMapObjectId,
            placementMapObjectId: plant.placementMapObjectId, displayName: plant.displayName,
            taxonomyReferenceId: plant.taxonomyReferenceId, varietyLabel: plant.varietyLabel,
            acceptedIdentificationId: plant.acceptedIdentificationId, acquisitionDate: plant.acquisitionDate,
            acquisitionDateType: plant.acquisitionDateType, groupingKind: plant.groupingKind, quantity: plant.quantity,
            lifecycleStage: stage, status: plant.status, conditionNote: plant.conditionNote,
            careGuidanceNote: plant.careGuidanceNote, revision: plant.revision + 1,
            createdByProfileId: plant.createdByProfileId, createdAt: plant.createdAt, updatedAt: plant.updatedAt
        )
    }

    private func withStatus(_ plant: Plant, _ status: PlantStatus) -> Plant {
        Plant(
            id: plant.id, gardenId: plant.gardenId, gardenAreaMapObjectId: plant.gardenAreaMapObjectId,
            placementMapObjectId: plant.placementMapObjectId, displayName: plant.displayName,
            taxonomyReferenceId: plant.taxonomyReferenceId, varietyLabel: plant.varietyLabel,
            acceptedIdentificationId: plant.acceptedIdentificationId, acquisitionDate: plant.acquisitionDate,
            acquisitionDateType: plant.acquisitionDateType, groupingKind: plant.groupingKind, quantity: plant.quantity,
            lifecycleStage: plant.lifecycleStage, status: status, conditionNote: plant.conditionNote,
            careGuidanceNote: plant.careGuidanceNote, revision: plant.revision + 1,
            createdByProfileId: plant.createdByProfileId, createdAt: plant.createdAt, updatedAt: plant.updatedAt
        )
    }
}
