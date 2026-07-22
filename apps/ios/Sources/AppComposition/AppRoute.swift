/// Destinations the application router owns.
///
/// Features declare destinations here rather than reaching into another
/// feature's view hierarchy, so navigation stays a property of the application
/// rather than of whichever screen happens to be on top.
///
/// The type exists so deep links are parsed into these cases, and retrofitting
/// a router after several features exist means rewriting their navigation.
///
/// Garden detail is deliberately absent: it is dynamic (one case per garden
/// ID makes no sense for `CaseIterable`), so `GardensListView` navigates to
/// it with a plain `NavigationLink(value: gardenId)` inside its own
/// `NavigationStack` path instead.
///
/// Source: architecture/ios-application-design.md, section "14. Navigation".
public enum AppRoute: Hashable, Sendable, CaseIterable {
    case gardens
    case serviceHealth
}
