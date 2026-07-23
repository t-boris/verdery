import CoreDomain
import CoreObservability
import Foundation

/// The application's view of the observation history operations.
///
/// Features depend on this protocol, never on `URLSession` or a generated
/// client, so a feature test needs no network and no server — the same
/// reason `GardenGateway` exists.
///
/// Source: architecture/ios-application-design.md, section "9. Networking";
/// packages/api-contracts/openapi.yaml, tag `Observations`.
public protocol ObservationGateway: Sendable {
    /// `photoMediaIds` is always empty this pass — see
    /// `FeatureObservations`'s doc comment for why.
    func recordObservation(
        gardenId: String,
        plantId: String?,
        gardenObjectId: String?,
        noteText: String?,
        conditionSummary: String?,
        observedAt: Date?,
        photoMediaIds: [String],
        idempotencyKey: String
    ) async throws -> GardenObservation

    func listObservationsForGarden(gardenId: String) async throws -> [GardenObservation]

    func listObservationsForPlant(gardenId: String, plantId: String) async throws -> [GardenObservation]

    /// `photoMediaIds` is always empty this pass — the same gap
    /// `recordObservation` documents.
    func correctObservation(
        observationId: String,
        correctionKind: ObservationCorrectionKind,
        noteText: String?,
        conditionSummary: String?,
        photoMediaIds: [String],
        idempotencyKey: String
    ) async throws -> GardenObservation
}

/// URLSession-backed implementation of the observation history operations.
public struct URLSessionObservationGateway: ObservationGateway {
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

    public func recordObservation(
        gardenId: String,
        plantId: String?,
        gardenObjectId: String?,
        noteText: String?,
        conditionSummary: String?,
        observedAt: Date?,
        photoMediaIds: [String],
        idempotencyKey: String
    ) async throws -> GardenObservation {
        let result: ObservationTransport = try await transport.send(
            method: "POST",
            operationPath: "gardens/\(gardenId)/observations",
            body: RecordObservationRequestTransport(
                plantId: plantId,
                gardenObjectId: gardenObjectId,
                noteText: noteText,
                conditionSummary: conditionSummary,
                observedAt: observedAt,
                photoMediaIds: photoMediaIds
            ),
            headers: [APIConfiguration.idempotencyKeyHeader: idempotencyKey],
            acceptedStatusCodes: [201]
        )
        return result.domainValue
    }

    public func listObservationsForGarden(gardenId: String) async throws -> [GardenObservation] {
        let result: ObservationListResultTransport = try await transport.get(
            operationPath: "gardens/\(gardenId)/observations",
            acceptedStatusCodes: [200]
        )
        return result.items.map(\.domainValue)
    }

    public func listObservationsForPlant(gardenId: String, plantId: String) async throws -> [GardenObservation] {
        let result: ObservationListResultTransport = try await transport.get(
            operationPath: "gardens/\(gardenId)/plants/\(plantId)/observations",
            acceptedStatusCodes: [200]
        )
        return result.items.map(\.domainValue)
    }

    public func correctObservation(
        observationId: String,
        correctionKind: ObservationCorrectionKind,
        noteText: String?,
        conditionSummary: String?,
        photoMediaIds: [String],
        idempotencyKey: String
    ) async throws -> GardenObservation {
        let result: ObservationTransport = try await transport.send(
            method: "POST",
            operationPath: "observations/\(observationId)/corrections",
            body: CorrectObservationRequestTransport(
                correctionKind: correctionKind,
                noteText: noteText,
                conditionSummary: conditionSummary,
                photoMediaIds: photoMediaIds
            ),
            headers: [APIConfiguration.idempotencyKeyHeader: idempotencyKey],
            acceptedStatusCodes: [201]
        )
        return result.domainValue
    }
}
