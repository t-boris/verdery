import CoreDomain
import CoreObservability
import Foundation

/// The application's view of the plant-candidate, conversion, and
/// suitability operations.
///
/// Every operation here is ONLINE-ONLY by deliberate decision, not
/// omission: candidates are not a synced record family (`plant_candidate`
/// is absent from the backend's `SyncRecordType` list, unlike `plant`/
/// `observation`/`task`), so no command here is routed through the offline
/// outbox — see `FeatureRecommendations.RecommendationGateway`'s identical
/// doc comment for the same reasoning applied to a different, already-built
/// online-only resource family. `FeatureCandidates` degrades honestly when
/// offline instead of projecting a local record it has nowhere to
/// reconcile against.
///
/// Source: architecture/ios-application-design.md, section "9. Networking";
/// packages/api-contracts/openapi.yaml, tag `PlantCandidates`;
/// implementation-plan.md work package P11-IOS-01.
public protocol PlantCandidateGateway: Sendable {
    func addCandidate(
        gardenId: String,
        displayName: String,
        taxonomyReferenceId: String?,
        varietyLabel: String?,
        groupingKind: PlantGroupingKind,
        quantity: Int?,
        rationaleNote: String?,
        priority: PlantCandidatePriority?,
        priceAmount: Double?,
        priceCurrency: String?,
        purchaseSource: String?,
        proposedGardenAreaMapObjectId: String?,
        proposedPlacementMapObjectId: String?,
        idempotencyKey: String
    ) async throws -> PlantCandidate

    /// `query`/`cursor` omitted lists every candidate in the garden, most
    /// recent first — the contract's own default. `status`/`priority`
    /// omitted or empty matches every value; the contract accepts more than
    /// one value for each. `identified` restricts to candidates with
    /// (`true`) or without (`false`) a resolved `taxonomyReferenceId` when
    /// given, matches every candidate when `nil`.
    func listCandidates(
        gardenId: String,
        query: String?,
        status: [PlantCandidateStatus]?,
        priority: [PlantCandidatePriority]?,
        identified: Bool?,
        cursor: String?,
        limit: Int?
    ) async throws -> PlantCandidateListPage

    func getCandidate(gardenId: String, candidateId: String) async throws -> PlantCandidate

    func updateCandidateDetails(
        gardenId: String,
        candidateId: String,
        displayName: String?,
        taxonomyReferenceId: FieldUpdate<String>,
        varietyLabel: FieldUpdate<String>,
        quantity: FieldUpdate<Int>,
        rationaleNote: FieldUpdate<String>,
        priority: FieldUpdate<PlantCandidatePriority>,
        priceAmount: FieldUpdate<Double>,
        priceCurrency: FieldUpdate<String>,
        purchaseSource: FieldUpdate<String>,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> PlantCandidate

    /// `status` must never be `.converted` — see
    /// `SetCandidateStatusRequestTransport`'s own doc comment.
    func setCandidateStatus(
        gardenId: String,
        candidateId: String,
        status: PlantCandidateStatus,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> PlantCandidate

    /// Permanent removal, unlike `setCandidateStatus`'s `.archived`/`.rejected`.
    /// A `.converted` candidate is refused by the API — its conversion record is
    /// the resulting plant's provenance.
    func deleteCandidate(
        gardenId: String,
        candidateId: String,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws

    func convertCandidate(
        gardenId: String,
        candidateId: String,
        gardenAreaMapObjectId: String?,
        placementMapObjectId: String?,
        acquisitionDate: String?,
        acquisitionDateType: PlantAcquisitionDateType?,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> ConvertCandidateResult

    /// The candidate's latest suitability assessment. Throws with a `404`
    /// both when none has ever been computed — `recalculateCandidateSuitability`
    /// is what a caller is expected to call first.
    func getCandidateSuitability(gardenId: String, candidateId: String) async throws -> SuitabilityAssessment

    /// Always persists a fresh append-only assessment, even an all-`unknown`
    /// result — a candidate with no identified taxon yet still produces a
    /// real, meaningful result. No `expectedRevision`/`idempotencyKey`:
    /// naturally safe to call repeatedly, the contract's own description.
    func recalculateCandidateSuitability(
        gardenId: String,
        candidateId: String
    ) async throws -> SuitabilityAssessment
}

/// One page of `ListCandidates` results — mirrors `PlantSearchPage`'s own shape.
public struct PlantCandidateListPage: Equatable, Sendable {
    public let items: [PlantCandidate]
    /// Opaque. `nil` means no further page exists.
    public let nextCursor: String?

    public init(items: [PlantCandidate], nextCursor: String?) {
        self.items = items
        self.nextCursor = nextCursor
    }
}

/// URLSession-backed implementation of the plant-candidate, conversion, and
/// suitability operations.
public struct URLSessionPlantCandidateGateway: PlantCandidateGateway {
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

    public func addCandidate(
        gardenId: String,
        displayName: String,
        taxonomyReferenceId: String?,
        varietyLabel: String?,
        groupingKind: PlantGroupingKind,
        quantity: Int?,
        rationaleNote: String?,
        priority: PlantCandidatePriority?,
        priceAmount: Double?,
        priceCurrency: String?,
        purchaseSource: String?,
        proposedGardenAreaMapObjectId: String?,
        proposedPlacementMapObjectId: String?,
        idempotencyKey: String
    ) async throws -> PlantCandidate {
        let result: PlantCandidateTransport = try await transport.send(
            method: "POST",
            operationPath: "gardens/\(gardenId)/plant-candidates",
            body: AddCandidateRequestTransport(
                proposedGardenAreaMapObjectId: proposedGardenAreaMapObjectId,
                proposedPlacementMapObjectId: proposedPlacementMapObjectId,
                displayName: displayName,
                taxonomyReferenceId: taxonomyReferenceId,
                varietyLabel: varietyLabel,
                groupingKind: groupingKind,
                quantity: quantity,
                rationaleNote: rationaleNote,
                priority: priority,
                priceAmount: priceAmount,
                priceCurrency: priceCurrency,
                purchaseSource: purchaseSource
            ),
            headers: [APIConfiguration.idempotencyKeyHeader: idempotencyKey],
            acceptedStatusCodes: [201]
        )
        return result.domainValue
    }

    public func listCandidates(
        gardenId: String,
        query: String?,
        status: [PlantCandidateStatus]?,
        priority: [PlantCandidatePriority]?,
        identified: Bool?,
        cursor: String?,
        limit: Int?
    ) async throws -> PlantCandidateListPage {
        var queryItems: [String] = []
        if let query, let encoded = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) {
            queryItems.append("query=\(encoded)")
        }
        if let status, !status.isEmpty {
            queryItems.append("status=\(status.map(\.rawValue).joined(separator: ","))")
        }
        if let priority, !priority.isEmpty {
            queryItems.append("priority=\(priority.map(\.rawValue).joined(separator: ","))")
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

        var path = "gardens/\(gardenId)/plant-candidates"
        if !queryItems.isEmpty {
            path += "?" + queryItems.joined(separator: "&")
        }

        let result: PlantCandidateListResultTransport = try await transport.get(
            operationPath: path,
            acceptedStatusCodes: [200]
        )
        return PlantCandidateListPage(
            items: result.items.map(\.domainValue),
            nextCursor: result.nextCursor
        )
    }

    public func getCandidate(gardenId: String, candidateId: String) async throws -> PlantCandidate {
        let result: PlantCandidateTransport = try await transport.get(
            operationPath: "gardens/\(gardenId)/plant-candidates/\(candidateId)",
            acceptedStatusCodes: [200]
        )
        return result.domainValue
    }

    public func updateCandidateDetails(
        gardenId: String,
        candidateId: String,
        displayName: String?,
        taxonomyReferenceId: FieldUpdate<String>,
        varietyLabel: FieldUpdate<String>,
        quantity: FieldUpdate<Int>,
        rationaleNote: FieldUpdate<String>,
        priority: FieldUpdate<PlantCandidatePriority>,
        priceAmount: FieldUpdate<Double>,
        priceCurrency: FieldUpdate<String>,
        purchaseSource: FieldUpdate<String>,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> PlantCandidate {
        let result: PlantCandidateTransport = try await transport.send(
            method: "PATCH",
            operationPath: "gardens/\(gardenId)/plant-candidates/\(candidateId)",
            body: UpdateCandidateDetailsRequestTransport(
                displayName: displayName,
                taxonomyReferenceId: taxonomyReferenceId,
                varietyLabel: varietyLabel,
                quantity: quantity,
                rationaleNote: rationaleNote,
                priority: priority,
                priceAmount: priceAmount,
                priceCurrency: priceCurrency,
                purchaseSource: purchaseSource
            ),
            headers: revisionHeaders(expectedRevision: expectedRevision, idempotencyKey: idempotencyKey),
            acceptedStatusCodes: [200]
        )
        return result.domainValue
    }

    public func setCandidateStatus(
        gardenId: String,
        candidateId: String,
        status: PlantCandidateStatus,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> PlantCandidate {
        let result: PlantCandidateTransport = try await transport.send(
            method: "POST",
            operationPath: "gardens/\(gardenId)/plant-candidates/\(candidateId)/status",
            body: SetCandidateStatusRequestTransport(status: status),
            headers: revisionHeaders(expectedRevision: expectedRevision, idempotencyKey: idempotencyKey),
            acceptedStatusCodes: [200]
        )
        return result.domainValue
    }

    public func deleteCandidate(
        gardenId: String,
        candidateId: String,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws {
        try await transport.sendNoContent(
            method: "DELETE",
            operationPath: "gardens/\(gardenId)/plant-candidates/\(candidateId)",
            headers: revisionHeaders(expectedRevision: expectedRevision, idempotencyKey: idempotencyKey)
        )
    }

    public func convertCandidate(
        gardenId: String,
        candidateId: String,
        gardenAreaMapObjectId: String?,
        placementMapObjectId: String?,
        acquisitionDate: String?,
        acquisitionDateType: PlantAcquisitionDateType?,
        expectedRevision: Int,
        idempotencyKey: String
    ) async throws -> ConvertCandidateResult {
        let result: ConvertCandidateResultTransport = try await transport.send(
            method: "POST",
            operationPath: "gardens/\(gardenId)/plant-candidates/\(candidateId)/convert",
            body: ConvertCandidateRequestTransport(
                gardenAreaMapObjectId: gardenAreaMapObjectId,
                placementMapObjectId: placementMapObjectId,
                acquisitionDate: acquisitionDate,
                acquisitionDateType: acquisitionDateType
            ),
            headers: revisionHeaders(expectedRevision: expectedRevision, idempotencyKey: idempotencyKey),
            acceptedStatusCodes: [201]
        )
        return result.domainValue
    }

    public func getCandidateSuitability(
        gardenId: String,
        candidateId: String
    ) async throws -> SuitabilityAssessment {
        let result: SuitabilityAssessmentTransport = try await transport.get(
            operationPath: "gardens/\(gardenId)/plant-candidates/\(candidateId)/suitability",
            acceptedStatusCodes: [200]
        )
        return result.domainValue
    }

    public func recalculateCandidateSuitability(
        gardenId: String,
        candidateId: String
    ) async throws -> SuitabilityAssessment {
        let result: SuitabilityAssessmentTransport = try await transport.send(
            method: "POST",
            operationPath: "gardens/\(gardenId)/plant-candidates/\(candidateId)/suitability",
            acceptedStatusCodes: [201]
        )
        return result.domainValue
    }

    private func revisionHeaders(expectedRevision: Int, idempotencyKey: String) -> [String: String] {
        [
            APIConfiguration.idempotencyKeyHeader: idempotencyKey,
            APIConfiguration.ifMatchHeader: "\"\(expectedRevision)\"",
        ]
    }
}
