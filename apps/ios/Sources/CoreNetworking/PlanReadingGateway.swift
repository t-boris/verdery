import CoreDomain
import CoreObservability
import Foundation

/// Reading a surveyor's plat, and tracing what an aerial photograph shows.
///
/// Both return **proposals and nothing else**. Neither writes garden state, and
/// accepting anything either produces is a separate, ordinary act — a
/// georeference for the location and north, map commands for the shapes — each
/// carrying its own authorization, revision and audit trail. That separation is
/// ADR-0018's whole point, and it is why this gateway has no "accept" method
/// for a caller to reach for by mistake.
public protocol PlanReadingGateway: Sendable {
    /// Transcribes an uploaded plat and walks its calls into a boundary whose
    /// closure error is reported rather than hidden.
    ///
    /// A page that is not a plat answers with `isPlat: false` — a real answer,
    /// not an error.
    func readPlatFromPlan(
        gardenId: String,
        planMediaId: String,
        idempotencyKey: String
    ) async throws -> PlatReading

    /// What an aerial photograph appears to show over a georeferenced garden.
    func traceFromAerial(gardenId: String, idempotencyKey: String) async throws -> AerialTracing
}

struct PlatBearingTransport: Decodable {
    let reference: String
    let degrees: Double
    let minutes: Double
    let seconds: Double
    let turn: String

    /// Rendered the way a plat prints it, so a reviewer checking the reading
    /// against the drawing is comparing the same string.
    var text: String {
        let heading = reference == "south" ? "S" : "N"
        let turnLetter = turn == "west" ? "W" : "E"
        return "\(heading) \(Int(degrees))°\(Int(minutes))'\(Int(seconds))\" \(turnLetter)"
    }
}

struct PlatBoundaryCallTransport: Decodable {
    let bearing: PlatBearingTransport?
    let distanceFeet: Double
    let sourceLabel: String
}

struct RecoveredBearingTransport: Decodable {
    let callNumber: Int
    let lengthDisagreementMetres: Double

    var domainValue: RecoveredBearing {
        RecoveredBearing(
            callNumber: callNumber,
            lengthDisagreementMetres: lengthDisagreementMetres
        )
    }
}

struct PlatBoundaryTransport: Decodable {
    let geometry: Geometry
    let closureErrorMetres: Double
    let closes: Bool
    let areaSquareMetres: Double
    let recoveredBearing: RecoveredBearingTransport?

    var domainValue: PlatBoundary {
        PlatBoundary(
            geometry: geometry,
            closureErrorMetres: closureErrorMetres,
            closes: closes,
            areaSquareMetres: areaSquareMetres,
            recoveredBearing: recoveredBearing?.domainValue
        )
    }
}

struct ProposedPlatObjectTransport: Decodable {
    let category: String
    let label: String
    let geometry: Geometry
    let confidence: Double
    let areaSquareMetres: Double
}

struct PlatReadingTransport: Decodable {
    let isPlat: Bool
    let address: String?
    let northRotationDegrees: Double?
    let statedAreaSquareFeet: Double?
    let boundaryCalls: [PlatBoundaryCallTransport]
    let boundary: PlatBoundaryTransport?
    let objects: [ProposedPlatObjectTransport]
    let pageFitResidualMetres: Double?

    var domainValue: PlatReading {
        PlatReading(
            isPlat: isPlat,
            address: address,
            northRotationDegrees: northRotationDegrees,
            statedAreaSquareFeet: statedAreaSquareFeet,
            // Numbered here rather than by the server, because "call 3" is how
            // a person counts down a printed list and the wire carries an
            // ordered array with no numbers in it.
            boundaryCalls: boundaryCalls.enumerated().map { index, call in
                PlatBoundaryCall(
                    callNumber: index + 1,
                    bearingText: call.bearing?.text,
                    distanceFeet: call.distanceFeet,
                    sourceLabel: call.sourceLabel
                )
            },
            boundary: boundary?.domainValue,
            // An object whose category this build does not know is dropped
            // rather than guessed at: proposing to draw an unknown shape as
            // something else is worse than not proposing it.
            objects: objects.enumerated().compactMap { index, object in
                guard let category = GardenObjectCategory(rawValue: object.category) else {
                    return nil
                }
                return ProposedPlatObject(
                    id: "plat-object-\(index)",
                    category: category,
                    label: object.label,
                    geometry: object.geometry,
                    confidence: object.confidence,
                    areaSquareMetres: object.areaSquareMetres
                )
            },
            pageFitResidualMetres: pageFitResidualMetres
        )
    }
}

struct AerialTracingProposalTransport: Decodable {
    let category: String
    let label: String
    let geometry: Geometry
    let confidence: Double
    let evidence: String
}

struct AerialTracingTransport: Decodable {
    let source: String
    let proposals: [AerialTracingProposalTransport]
    let disclaimer: String

    var domainValue: AerialTracing {
        AerialTracing(
            source: source,
            disclaimer: disclaimer,
            proposals: proposals.enumerated().compactMap { index, proposal in
                guard let category = GardenObjectCategory(rawValue: proposal.category) else {
                    return nil
                }
                return AerialTracingProposal(
                    id: "aerial-\(index)",
                    category: category,
                    label: proposal.label,
                    geometry: proposal.geometry,
                    confidence: proposal.confidence,
                    // An unrecognised evidence word decodes as `inferred`,
                    // which is the weaker claim. Overstating what a photograph
                    // showed is the error that matters here.
                    evidence: AerialEvidence(rawValue: proposal.evidence) ?? .inferred
                )
            }
        )
    }
}

public struct URLSessionPlanReadingGateway: PlanReadingGateway {
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

    public func readPlatFromPlan(
        gardenId: String,
        planMediaId: String,
        idempotencyKey: String
    ) async throws -> PlatReading {
        let response: PlatReadingTransport = try await transport.send(
            method: "POST",
            operationPath: "gardens/\(gardenId)/plans/\(planMediaId)/reading",
            headers: [APIConfiguration.idempotencyKeyHeader: idempotencyKey],
            acceptedStatusCodes: [200]
        )
        return response.domainValue
    }

    public func traceFromAerial(
        gardenId: String,
        idempotencyKey: String
    ) async throws -> AerialTracing {
        let response: AerialTracingTransport = try await transport.send(
            method: "POST",
            operationPath: "gardens/\(gardenId)/aerial-tracing",
            headers: [APIConfiguration.idempotencyKeyHeader: idempotencyKey],
            acceptedStatusCodes: [200]
        )
        return response.domainValue
    }
}
