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
    /// Each attachment carries the shot purpose chosen for it
    /// (P11-MEDIA-01). Nothing is defaulted here: a purpose invented at this
    /// boundary would put the photograph into a comparison sequence it does
    /// not belong to.
    func recordObservation(
        gardenId: String,
        plantId: String?,
        gardenObjectId: String?,
        noteText: String?,
        conditionSummary: String?,
        observedAt: Date?,
        photos: [ObservationPhotoAttachment],
        idempotencyKey: String
    ) async throws -> GardenObservation

    func listObservationsForGarden(gardenId: String) async throws -> [GardenObservation]

    func listObservationsForPlant(gardenId: String, plantId: String) async throws -> [GardenObservation]

    /// `ListPlantJournalFrames` (P11-MEDIA-01): a plant's photographs in
    /// observed order, oldest first.
    ///
    /// `purpose` narrows the sequence to one kind of shot, which is what makes
    /// consecutive frames comparable; passing nil returns every photograph,
    /// including those carrying no label at all. `limit` is a bound on the
    /// sequence, not a page size — this operation has no cursor, and asking
    /// for fewer frames asks for a shorter sequence.
    func listPlantJournalFrames(
        gardenId: String,
        plantId: String,
        purpose: ObservationPhotoPurpose?,
        limit: Int?
    ) async throws -> [PlantJournalFrame]

    /// See `recordObservation`'s identical doc comment.
    func correctObservation(
        observationId: String,
        correctionKind: ObservationCorrectionKind,
        noteText: String?,
        conditionSummary: String?,
        photos: [ObservationPhotoAttachment],
        idempotencyKey: String
    ) async throws -> GardenObservation

    /// `SetHealthSuggestionDisposition` (P11-HEALTH-01): records the
    /// caller's disposition on an already-produced health suggestion. No
    /// `expectedRevision`/`If-Match` — `image_analysis_result` carries no
    /// revision, and a disposition may be reconsidered freely.
    func setHealthSuggestionDisposition(
        analysisResultId: String,
        disposition: HealthSuggestionDisposition,
        idempotencyKey: String
    ) async throws -> ImageAnalysisResult
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
        photos: [ObservationPhotoAttachment],
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
                photos: photos.map(ObservationPhotoAttachmentRequestTransport.init(attachment:))
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

    public func listPlantJournalFrames(
        gardenId: String,
        plantId: String,
        purpose: ObservationPhotoPurpose?,
        limit: Int?
    ) async throws -> [PlantJournalFrame] {
        var queryItems: [String] = []
        if let purpose {
            queryItems.append("purpose=\(purpose.rawValue)")
        }
        if let limit {
            queryItems.append("limit=\(limit)")
        }

        var path = "gardens/\(gardenId)/plants/\(plantId)/journal-frames"
        if !queryItems.isEmpty {
            path += "?" + queryItems.joined(separator: "&")
        }

        let result: PlantJournalFrameListResultTransport = try await transport.get(
            operationPath: path,
            acceptedStatusCodes: [200]
        )
        return result.items.map(\.domainValue)
    }

    public func correctObservation(
        observationId: String,
        correctionKind: ObservationCorrectionKind,
        noteText: String?,
        conditionSummary: String?,
        photos: [ObservationPhotoAttachment],
        idempotencyKey: String
    ) async throws -> GardenObservation {
        let result: ObservationTransport = try await transport.send(
            method: "POST",
            operationPath: "observations/\(observationId)/corrections",
            body: CorrectObservationRequestTransport(
                correctionKind: correctionKind,
                noteText: noteText,
                conditionSummary: conditionSummary,
                photos: photos.map(ObservationPhotoAttachmentRequestTransport.init(attachment:))
            ),
            headers: [APIConfiguration.idempotencyKeyHeader: idempotencyKey],
            acceptedStatusCodes: [201]
        )
        return result.domainValue
    }

    public func setHealthSuggestionDisposition(
        analysisResultId: String,
        disposition: HealthSuggestionDisposition,
        idempotencyKey: String
    ) async throws -> ImageAnalysisResult {
        let result: ImageAnalysisResultTransport = try await transport.send(
            method: "POST",
            operationPath: "observations/analysis-results/\(analysisResultId)/disposition",
            body: SetHealthSuggestionDispositionRequestTransport(disposition: disposition),
            headers: [APIConfiguration.idempotencyKeyHeader: idempotencyKey],
            acceptedStatusCodes: [200]
        )
        return result.domainValue
    }
}
