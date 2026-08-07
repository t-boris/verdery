/// Immutable display state for the "Add a plant"/"Open a plant" form-only
/// screen — a `Plant` list has nowhere to come from (see `PlantsHomeView`'s
/// doc comment), so, unlike `GardensListViewState`, there is no `loaded`
/// case carrying rows: this screen never loads anything from the network on
/// its own.
public enum PlantsHomeViewState: Equatable, Sendable {
    case idle
    case submitting
    case failed(message: String)
}

/// The review stack, pushed onto the Plants tab's own stack.
///
/// It lives with Plants rather than as a sixth tab because what it reviews are
/// plants, and because it is entered from two places that are both here: the
/// "needs you" badge on the plants list, and the summary a capture run shows
/// when it ends.
public struct PlantsReviewRoute: Hashable, Sendable {
    public let gardenId: String

    public init(gardenId: String) {
        self.gardenId = gardenId
    }
}
