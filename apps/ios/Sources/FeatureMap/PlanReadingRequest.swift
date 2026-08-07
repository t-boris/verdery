/// Which uploaded plan is being read.
///
/// A wrapper rather than a bare `String`, because `sheet(item:)` needs an
/// `Identifiable` and a raw identifier is not one. Naming the wrapper is also
/// honest about what it carries: a request to read, which is not the same thing
/// as a plan.
struct PlanReadingRequest: Identifiable, Hashable {
    let planMediaId: String

    var id: String { planMediaId }
}
