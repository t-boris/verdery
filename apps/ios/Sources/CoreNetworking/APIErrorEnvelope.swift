import Foundation

/// A value interpolated into a localized error message.
///
/// The contract declares `parameters` as an open object. Only scalars are ever
/// interpolated into a message, so anything else is rejected at the boundary
/// instead of being carried into the application as untyped data.
public enum ContractParameter: Equatable, Sendable, Decodable {
    case number(Double)
    case text(String)
    case flag(Bool)

    public init(from decoder: any Decoder) throws {
        let container = try decoder.singleValueContainer()

        if let value = try? container.decode(Bool.self) {
            self = .flag(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .text(value)
        } else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "An error parameter must be a string, number, or boolean."
            )
        }
    }
}

/// One structural detail of a failed request.
public struct APIErrorDetail: Equatable, Sendable, Decodable {
    /// Stable machine-readable detail code.
    public let code: String
    /// JSON Pointer to the offending member, where the error is structural.
    public let pointer: String?
    /// Values interpolated into the localized message. Never free-form prose.
    public let parameters: [String: ContractParameter]?
}

/// The body of the contract's error envelope.
public struct APIErrorBody: Equatable, Sendable, Decodable {
    /// Stable dotted code. Clients localize known errors by this value rather
    /// than by displaying `message`.
    public let code: String
    /// Safe fallback text in English. Not a localization source.
    public let message: String
    /// Identifier for correlating this response with server telemetry.
    public let correlationId: String
    public let details: [APIErrorDetail]?
    /// Whether repeating the identical request may succeed later.
    public let retryable: Bool

    /// `Decodable` conformance alone only synthesizes a public `init(from:)`,
    /// not a public memberwise initializer — added explicitly so a fake
    /// `SyncGateway` in another module's tests (`CoreSynchronizationTests
    /// .RemoteSyncEnginePullTests`, P5-IOS-03, Stage 5b) can construct an
    /// `APIGatewayError.service` value directly, without round-tripping
    /// through JSON just to build a test fixture.
    public init(
        code: String,
        message: String,
        correlationId: String,
        details: [APIErrorDetail]? = nil,
        retryable: Bool
    ) {
        self.code = code
        self.message = message
        self.correlationId = correlationId
        self.details = details
        self.retryable = retryable
    }

    /// The shared code when this is one the request pipeline itself produces.
    ///
    /// `nil` means the code belongs to a module and is handled by that module's
    /// feature, not that the error is unknown.
    public var sharedCode: SharedErrorCode? {
        SharedErrorCode(rawValue: code)
    }
}

/// The only error shape the API returns.
///
/// Source: packages/api-contracts/openapi.yaml, `Error`.
public struct APIErrorEnvelope: Equatable, Sendable, Decodable {
    public let error: APIErrorBody
}
