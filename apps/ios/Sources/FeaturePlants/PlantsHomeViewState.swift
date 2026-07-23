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
