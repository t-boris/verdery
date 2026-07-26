/// Immutable display state for the account screen.
///
/// `signedOut` is a real state rather than a return value: signing out is
/// reported to the shell by the authentication SDK's own state listener, which
/// swaps the root away from this screen — see ``ProfileViewModel/signOut()``.
/// Holding it here keeps the model honest about what happened even though the
/// screen it describes is about to disappear.
///
/// Source: architecture/ios-application-design.md, section "5.1 Presentation".
public enum ProfileViewState: Equatable, Sendable {
    case idle
    case signedOut
    case failed(message: String)
}

/// One fact about the signed-in account, drawn as a chip.
///
/// The kind, not a colour or a symbol, is what the model reports: iconography
/// belongs to the view, and the presentation layer's own types stay free of
/// the design system exactly as every other view state here is.
public struct ProfileBadge: Equatable, Sendable, Identifiable {
    public enum Kind: Hashable, Sendable {
        case google
        case apple
        case emailLink
        case addressConfirmed
        case addressUnconfirmed
    }

    public let kind: Kind
    public let label: String

    public init(kind: Kind, label: String) {
        self.kind = kind
        self.label = label
    }

    public var id: Kind { kind }
}

/// One labelled figure about this build.
///
/// A fact exists only when its source does: a version string absent from the
/// bundle produces no entry at all, rather than a row labelled with nothing
/// beside it.
public struct ProfileFact: Equatable, Sendable, Identifiable {
    public enum Kind: Hashable, Sendable {
        case version
        case build
        case language
    }

    public let kind: Kind
    public let label: String
    public let value: String

    public init(kind: Kind, label: String, value: String) {
        self.kind = kind
        self.label = label
        self.value = value
    }

    public var id: Kind { kind }
}
