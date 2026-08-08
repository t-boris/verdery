import CoreDomain
import CoreObservability
import Foundation

/// Placing a garden on the Earth: finding where an address is, and recording
/// where the garden's origin sits.
///
/// Both halves are online-only and neither is offline-capable, which is the
/// honest shape: a geocoder is a third party, and a georeference is a
/// separately-revised record outside the map command model. The screens built
/// on this say so rather than queueing something they cannot queue.
public protocol GeographyGateway: Sendable {
    /// A suggestion, never a record. Nothing from the provider is stored —
    /// what persists is the anchor a person accepts.
    ///
    /// Worldwide, since 2026-08-08: the US Census geocoder behind this was
    /// replaced by Nominatim because a European address could not be found at
    /// all. Address data is © OpenStreetMap contributors and the interface
    /// says so wherever candidates are shown, which is what ODbL asks of a
    /// consumer that stores none of it.
    /// An address elsewhere returns no candidates, which is a real answer
    /// rather than a failure.
    func findAddressCandidates(query: String) async throws -> AddressCandidateList

    /// Records where the garden's local origin sits in WGS84 and how its local
    /// axes are rotated against true north.
    ///
    /// Each write supersedes the current record and creates a new revision
    /// rather than editing one in place, so a garden's geographic history stays
    /// readable. `expectedRevision` carries the revision the caller believes is
    /// current; `nil` asserts the garden has never been georeferenced. A
    /// disagreement is a `412`, never a silent overwrite.
    func setGardenGeoreference(
        gardenId: String,
        draft: GeoreferenceDraft,
        expectedRevision: Int?
    ) async throws -> GardenGeoreference
}

struct AddressCandidateTransport: Decodable {
    let formattedAddress: String
    let position: Position
    let precision: String

    /// An unrecognised precision decodes as the coarsest one. Overstating how
    /// precisely a provider located an address is the error that matters here:
    /// somebody would accept a town centre believing it was their roof.
    var domainValue: AddressCandidate {
        AddressCandidate(
            formattedAddress: formattedAddress,
            position: position,
            precision: AddressPrecision(rawValue: precision) ?? .area
        )
    }
}

struct AddressCandidateListTransport: Decodable {
    let items: [AddressCandidateTransport]
    let providerAvailable: Bool

    var domainValue: AddressCandidateList {
        AddressCandidateList(
            items: items.map(\.domainValue),
            providerAvailable: providerAvailable
        )
    }
}

struct SetGeoreferenceTransport: Encodable {
    let localAnchor: Position
    let geographicAnchor: Position
    let rotationDegrees: Double
    let accuracyMetres: Double?
    let displayAddress: String?
    let method: String
}

public struct URLSessionGeographyGateway: GeographyGateway {
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

    public func findAddressCandidates(query: String) async throws -> AddressCandidateList {
        let encoded = query.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? query
        let response: AddressCandidateListTransport = try await transport.get(
            operationPath: "geocoding/address-candidates?query=\(encoded)",
            acceptedStatusCodes: [200]
        )
        return response.domainValue
    }

    public func setGardenGeoreference(
        gardenId: String,
        draft: GeoreferenceDraft,
        expectedRevision: Int?
    ) async throws -> GardenGeoreference {
        guard let geographicAnchor = draft.geographicAnchor else {
            throw GeoreferenceDraftIncomplete()
        }

        // Omitting `If-Match` is not the same as sending one: it asserts the
        // garden has never been georeferenced, and the server tells the two
        // apart. So the header is absent rather than empty when there is no
        // revision to quote.
        var headers: [String: String] = [:]
        if let expectedRevision {
            headers[APIConfiguration.ifMatchHeader] = String(expectedRevision)
        }

        let response: GeoreferenceTransport = try await transport.send(
            method: "PUT",
            operationPath: "gardens/\(gardenId)/georeference",
            body: SetGeoreferenceTransport(
                localAnchor: draft.localAnchor,
                geographicAnchor: geographicAnchor,
                // Wrapped once, here, because a dial turning past north is a
                // gesture rather than the miscalculation the contract's
                // `[0, 360)` rejection is aimed at.
                rotationDegrees: draft.normalizedRotationDegrees,
                accuracyMetres: draft.accuracyMetres,
                displayAddress: draft.displayAddress,
                method: draft.method.rawValue
            ),
            headers: headers,
            acceptedStatusCodes: [200]
        )
        return response.domainValue
    }
}

/// Submitting a draft with no anchor. Unreachable from the screen, whose commit
/// control is disabled until there is one, and kept as a typed failure rather
/// than a precondition so a future caller gets an error instead of a crash.
public struct GeoreferenceDraftIncomplete: Error, Sendable {
    public init() {}
}
