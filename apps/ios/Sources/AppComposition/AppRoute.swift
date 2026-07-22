/// Destinations the application router owns.
///
/// Features declare destinations here rather than reaching into another
/// feature's view hierarchy, so navigation stays a property of the application
/// rather than of whichever screen happens to be on top.
///
/// Phase 1 has one destination. The type exists now because deep links are
/// parsed into these cases, and retrofitting a router after several features
/// exist means rewriting their navigation.
///
/// Source: architecture/ios-application-design.md, section "14. Navigation".
public enum AppRoute: Hashable, Sendable, CaseIterable {
    case serviceHealth
}
