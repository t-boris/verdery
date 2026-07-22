/// Immutable display state for the map editor screen.
///
/// `loaded` carries the render snapshot directly — unlike
/// `GardensListViewState.loaded([GardenSummary])`, the map editor's canvas
/// needs the *shapes*, not a pre-flattened row list, so the snapshot itself
/// is what "loaded" means here.
public enum MapEditorViewState: Equatable, Sendable {
    case loading
    case loaded(MapRenderSnapshot)
    case failed(message: String)
}
