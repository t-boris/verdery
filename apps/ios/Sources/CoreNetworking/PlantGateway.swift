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

    private func revisionHeaders(expectedRevision: Int, idempotencyKey: String) -> [String: String] {
        [
            APIConfiguration.idempotencyKeyHeader: idempotencyKey,
            APIConfiguration.ifMatchHeader: "\"\(expectedRevision)\"",
        ]
    }
}
