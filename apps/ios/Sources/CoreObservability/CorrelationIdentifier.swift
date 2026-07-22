import Foundation

/// Identifier propagated to the backend so a client action can be found in
/// server telemetry.
///
/// Every backend interaction carries one. It is generated on the client when the
/// request originates there, and echoed from the error envelope when the server
/// generated it.
///
/// Source: architecture/ios-application-design.md, section "18. Observability";
/// architecture/api-design.md, section "Error envelope".
public struct CorrelationIdentifier: Equatable, Hashable, Sendable, CustomStringConvertible {
    public let value: String

    public init(value: String) {
        self.value = value
    }

    /// Generates a fresh identifier.
    ///
    /// UUID is used rather than a shorter token because it is collision-free
    /// without coordination and is already the identifier shape the API uses.
    public static func generate() -> CorrelationIdentifier {
        CorrelationIdentifier(value: UUID().uuidString.lowercased())
    }

    public var description: String { value }
}

/// Source of correlation identifiers, injected so tests are deterministic.
///
/// Source: architecture/ios-application-design.md, section "19. Testing" —
/// "Tests use injected clocks, identifier generators, network gateways".
public protocol CorrelationIdentifierProvider: Sendable {
    func next() -> CorrelationIdentifier
}

public struct RandomCorrelationIdentifierProvider: CorrelationIdentifierProvider {
    public init() {}

    public func next() -> CorrelationIdentifier {
        .generate()
    }
}
