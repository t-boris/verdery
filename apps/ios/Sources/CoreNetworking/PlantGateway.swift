import CoreDomain
import CoreObservability
import Foundation

/// The application's view of the plant inventory operations.
///
/// Features depend on this protocol, never on `URLSession` or a generated
/// client, so a feature test needs no network and no server — the same
/// reason `GardenGateway` exists.
///
/// Source: architecture/ios-application-design.md, section "9. Networking";
/// packages/api-contracts/openapi.yaml, tag `Plants`.
public protocol PlantGateway: Sendable {
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
        idempotencyKey: String
    ) async throws -> Plant

    /// See `FeaturePlants`'s doc comment on the (deliberately absent) add-
    /// from-photo screen for why this method has no UI entry point this
    /// pass, even though it is fully implemented and tested here.
    func addPlantFromPhoto(
        gardenId: String,
        photoMediaId: String,
        gardenAreaMapObjectId: String?,
        placementMapObjectId: String?,
        idempotencyKey: String
    ) async throws -> Plant

    func getPlant(gardenId: String, plantId: String) async throws -> Plant

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
    ) async throws -> Plant

    func attachPlantPhoto(
        gardenId: String,
        plantId: String,
        mediaId: String,
        isPrimary: Bool?,
        idempotencyKey: String
    ) async throws -> PlantPhoto

    func setPrimaryPlantPhoto(
        gardenId: String,
        plantId: String,
        plantPhotoId: String,
        idempotencyKey: String
    ) async throws -> PlantPhoto

    func confirmPlantIdentification(
        gardenId: String,
        plantId: String,
        identificationId: String,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> Plant

    /// The plant's still-pending photo-identification suggestion. Throws
    /// with `plants_inventory.plant.identification_not_found` (`404`) both
    /// when the plant has none at all and once one has already been
    /// confirmed — see `FeaturePlants.FetchPlantIdentification`'s own doc
    /// comment for why a dedicated use case narrows that specific case to
    /// `nil` rather than every caller re-deriving the same check, the same
    /// shape `fetchGardenOwnershipTransfer`/`FetchGardenOwnershipTransfer`
    /// already establish for an identically-shaped "pending, or absent" read.
    func getPlantIdentification(gardenId: String, plantId: String) async throws -> PlantIdentification

    /// Records the identification's already-computed condition analysis
    /// (`suggestedConditionNote`/`suggestedCareGuidanceNote`) as a real
    /// `GardenObservation` — independent of, and combinable with,
    /// `confirmPlantIdentification` on the same row (ADR-0015's own
    /// "AddPlantFromPhoto suggests an observation too" extension). No
    /// `expectedRevision`: this never touches the plant's own row, only
    /// creates a child observation record.
    func recordObservationFromIdentification(
        gardenId: String,
        plantId: String,
        identificationId: String,
        idempotencyKey: String
    ) async throws -> GardenObservation

    func transitionLifecycleStage(
        gardenId: String,
        plantId: String,
        stage: PlantLifecycleStage,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> Plant

    func setStatus(
        gardenId: String,
        plantId: String,
        status: PlantStatus,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> Plant

    func movePlant(
        gardenId: String,
        plantId: String,
        gardenAreaMapObjectId: String?,
        placementMapObjectId: String?,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> Plant

    /// `query` omitted lists the catalog, most recent first — the contract's
    /// own default.
    func searchTaxonomyReferences(gardenId: String, query: String?, limit: Int?) async throws -> [TaxonomyReference]

    /// `query`/`cursor` omitted lists every plant in the garden, most recent
    /// first — the contract's own default. `cursor` is opaque, from a prior
    /// page's own `PlantSearchPage.nextCursor`. `status` omitted or empty
    /// matches every status; the contract accepts more than one value.
    /// `identified` (P11-SEARCH-01) restricts to plants with (`true`) or
    /// without (`false`) a resolved `taxonomyReferenceId`, matches every
    /// plant when `nil`.
    func searchPlants(
        gardenId: String,
        query: String?,
        status: [PlantStatus]?,
        identified: Bool?,
        cursor: String?,
        limit: Int?
    ) async throws -> PlantSearchPage

    func listPlantPhotos(gardenId: String, plantId: String) async throws -> [PlantPhoto]
}

/// One page of `SearchPlants` results — mirrors `GardenPage`'s own shape.
public struct PlantSearchPage: Equatable, Sendable {
    public let items: [Plant]
    /// Opaque. `nil` means no further page exists.
    public let nextCursor: String?

    public init(items: [Plant], nextCursor: String?) {
        self.items = items
        self.nextCursor = nextCursor
    }
}

/// URLSession-backed implementation of the plant inventory operations.
public struct URLSessionPlantGateway: PlantGateway {
    private let transport: HTTPTransport

    public init(
        configuration: APIConfiguration,
        session: URLSession = .shared,
        correlationIdentifiers: any CorrelationIdentifierProvider =
            RandomCorrelationIdentifierProvider(),
        authTokenProvider: any AuthTokenProvider,
        appCheckTokenProvider: (any AppCheckTokenProvider)? = nil,
        log: any DiagnosticLog = NoOperationDiagnosticLog()
    ) {
        self.transport = HTTPTransport(
            configuration: configuration,
            session: session,
            correlationIdentifiers: correlationIdentifiers,
            authTokenProvider: authTokenProvider,
            appCheckTokenProvider: appCheckTokenProvider,
            log: log
        )
    }

    public func addPlant(
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
        idempotencyKey: String
    ) async throws -> Plant {
        let result: PlantTransport = try await transport.send(
            method: "POST",
            operationPath: "gardens/\(gardenId)/plants",
            body: AddPlantRequestTransport(
                gardenAreaMapObjectId: gardenAreaMapObjectId,
                placementMapObjectId: placementMapObjectId,
                displayName: displayName,
                taxonomyReferenceId: taxonomyReferenceId,
                varietyLabel: varietyLabel,
                acquisitionDate: acquisitionDate,
                acquisitionDateType: acquisitionDateType,
                groupingKind: groupingKind,
                quantity: quantity
            ),
            headers: [APIConfiguration.idempotencyKeyHeader: idempotencyKey],
            acceptedStatusCodes: [201]
        )
        return result.domainValue
    }

    public func addPlantFromPhoto(
        gardenId: String,
        photoMediaId: String,
        gardenAreaMapObjectId: String?,
        placementMapObjectId: String?,
        idempotencyKey: String
    ) async throws -> Plant {
        let result: PlantTransport = try await transport.send(
            method: "POST",
            operationPath: "gardens/\(gardenId)/plants/from-photo",
            body: AddPlantFromPhotoRequestTransport(
                gardenAreaMapObjectId: gardenAreaMapObjectId,
                placementMapObjectId: placementMapObjectId,
                photoMediaId: photoMediaId
            ),
            headers: [APIConfiguration.idempotencyKeyHeader: idempotencyKey],
            acceptedStatusCodes: [201]
        )
        return result.domainValue
    }

    public func getPlant(gardenId: String, plantId: String) async throws -> Plant {
        let result: PlantTransport = try await transport.get(
            operationPath: "gardens/\(gardenId)/plants/\(plantId)",
            acceptedStatusCodes: [200]
        )
        return result.domainValue
    }

    public func updatePlantDetails(
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
        let result: PlantTransport = try await transport.send(
            method: "PATCH",
            operationPath: "gardens/\(gardenId)/plants/\(plantId)",
            body: UpdatePlantDetailsRequestTransport(
                displayName: displayName,
                taxonomyReferenceId: taxonomyReferenceId,
                varietyLabel: varietyLabel,
                acquisitionDate: acquisitionDate,
                acquisitionDateType: acquisitionDateType,
                conditionNote: conditionNote,
                careGuidanceNote: careGuidanceNote,
                quantity: quantity
            ),
            headers: revisionHeaders(expectedRevision: expectedRevision, idempotencyKey: idempotencyKey),
            acceptedStatusCodes: [200]
        )
        return result.domainValue
    }

    public func attachPlantPhoto(
        gardenId: String,
        plantId: String,
        mediaId: String,
        isPrimary: Bool?,
        idempotencyKey: String
    ) async throws -> PlantPhoto {
        let result: PlantPhotoTransport = try await transport.send(
            method: "POST",
            operationPath: "gardens/\(gardenId)/plants/\(plantId)/photos",
            body: AttachPlantPhotoRequestTransport(mediaId: mediaId, isPrimary: isPrimary),
            headers: [APIConfiguration.idempotencyKeyHeader: idempotencyKey],
            acceptedStatusCodes: [201]
        )
        return result.domainValue
    }

    public func setPrimaryPlantPhoto(
        gardenId: String,
        plantId: String,
        plantPhotoId: String,
        idempotencyKey: String
    ) async throws -> PlantPhoto {
        let result: PlantPhotoTransport = try await transport.send(
            method: "POST",
            operationPath: "gardens/\(gardenId)/plants/\(plantId)/photos/\(plantPhotoId)/primary",
            headers: [APIConfiguration.idempotencyKeyHeader: idempotencyKey],
            acceptedStatusCodes: [200]
        )
        return result.domainValue
    }

    public func confirmPlantIdentification(
        gardenId: String,
        plantId: String,
        identificationId: String,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> Plant {
        let result: PlantTransport = try await transport.send(
            method: "POST",
            operationPath: "gardens/\(gardenId)/plants/\(plantId)/identification/\(identificationId)/confirm",
            headers: revisionHeaders(expectedRevision: expectedRevision, idempotencyKey: idempotencyKey),
            acceptedStatusCodes: [200]
        )
        return result.domainValue
    }

    public func getPlantIdentification(gardenId: String, plantId: String) async throws -> PlantIdentification {
        let result: PlantIdentificationTransport = try await transport.get(
            operationPath: "gardens/\(gardenId)/plants/\(plantId)/identification",
            acceptedStatusCodes: [200]
        )
        return result.domainValue
    }

    public func recordObservationFromIdentification(
        gardenId: String,
        plantId: String,
        identificationId: String,
        idempotencyKey: String
    ) async throws -> GardenObservation {
        let result: ObservationTransport = try await transport.send(
            method: "POST",
            operationPath: "gardens/\(gardenId)/plants/\(plantId)/identification/\(identificationId)/record-observation",
            headers: [APIConfiguration.idempotencyKeyHeader: idempotencyKey],
            acceptedStatusCodes: [201]
        )
        return result.domainValue
    }

    public func transitionLifecycleStage(
        gardenId: String,
        plantId: String,
        stage: PlantLifecycleStage,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> Plant {
        let result: PlantTransport = try await transport.send(
            method: "POST",
            operationPath: "gardens/\(gardenId)/plants/\(plantId)/lifecycle-stage",
            body: TransitionPlantLifecycleStageRequestTransport(stage: stage),
            headers: revisionHeaders(expectedRevision: expectedRevision, idempotencyKey: idempotencyKey),
            acceptedStatusCodes: [200]
        )
        return result.domainValue
    }

    public func setStatus(
        gardenId: String,
        plantId: String,
        status: PlantStatus,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> Plant {
        let result: PlantTransport = try await transport.send(
            method: "POST",
            operationPath: "gardens/\(gardenId)/plants/\(plantId)/status",
            body: SetPlantStatusRequestTransport(status: status),
            headers: revisionHeaders(expectedRevision: expectedRevision, idempotencyKey: idempotencyKey),
            acceptedStatusCodes: [200]
        )
        return result.domainValue
    }

    public func movePlant(
        gardenId: String,
        plantId: String,
        gardenAreaMapObjectId: String?,
        placementMapObjectId: String?,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> Plant {
        let result: PlantTransport = try await transport.send(
            method: "POST",
            operationPath: "gardens/\(gardenId)/plants/\(plantId)/move",
            body: MovePlantRequestTransport(
                gardenAreaMapObjectId: gardenAreaMapObjectId,
                placementMapObjectId: placementMapObjectId
            ),
            headers: revisionHeaders(expectedRevision: expectedRevision, idempotencyKey: idempotencyKey),
            acceptedStatusCodes: [200]
        )
        return result.domainValue
    }

    public func searchTaxonomyReferences(
        gardenId: String,
        query: String?,
        limit: Int?
    ) async throws -> [TaxonomyReference] {
        var queryItems: [String] = []
        if let query, let encoded = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) {
            queryItems.append("query=\(encoded)")
        }
        if let limit {
            queryItems.append("limit=\(limit)")
        }

        var path = "gardens/\(gardenId)/taxonomy-references"
        if !queryItems.isEmpty {
            path += "?" + queryItems.joined(separator: "&")
        }

        let result: TaxonomyReferenceListResultTransport = try await transport.get(
            operationPath: path,
            acceptedStatusCodes: [200]
        )
        return result.items.map(\.domainValue)
    }

    public func searchPlants(
        gardenId: String,
        query: String?,
        status: [PlantStatus]?,
        identified: Bool?,
        cursor: String?,
        limit: Int?
    ) async throws -> PlantSearchPage {
        var queryItems: [String] = []
        if let query, let encoded = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) {
            queryItems.append("query=\(encoded)")
        }
        if let status, !status.isEmpty {
            queryItems.append("status=\(status.map(\.rawValue).joined(separator: ","))")
        }
        if let identified {
            queryItems.append("identified=\(identified)")
        }
        if let cursor, let encoded = cursor.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) {
            queryItems.append("cursor=\(encoded)")
        }
        if let limit {
            queryItems.append("limit=\(limit)")
        }

        var path = "gardens/\(gardenId)/plants"
        if !queryItems.isEmpty {
            path += "?" + queryItems.joined(separator: "&")
        }

        let result: PlantSearchPageTransport = try await transport.get(
            operationPath: path,
            acceptedStatusCodes: [200]
        )
        return PlantSearchPage(
            items: result.items.map(\.domainValue),
            nextCursor: result.nextCursor
        )
    }

    public func listPlantPhotos(gardenId: String, plantId: String) async throws -> [PlantPhoto] {
        let result: PlantPhotoListResultTransport = try await transport.get(
            operationPath: "gardens/\(gardenId)/plants/\(plantId)/photos",
            acceptedStatusCodes: [200]
        )
        return result.items.map(\.domainValue)
    }

    private func revisionHeaders(expectedRevision: Int, idempotencyKey: String) -> [String: String] {
        [
            APIConfiguration.idempotencyKeyHeader: idempotencyKey,
            APIConfiguration.ifMatchHeader: "\"\(expectedRevision)\"",
        ]
    }
}
