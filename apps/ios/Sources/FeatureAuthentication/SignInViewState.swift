/// Immutable display state for the sign-in screen.
///
/// Source: architecture/ios-application-design.md, section "5.1 Presentation".
public enum SignInViewState: Equatable, Sendable {
    case idle
    case signingIn
    case emailLinkSent
    case failed(message: String)
}
