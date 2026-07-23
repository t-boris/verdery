import CoreDomain

/// The logical layers a user can independently show/hide and lock, per
/// architecture/map-rendering-and-editing.md, section "12. Layer Model":
/// "Layer visibility and opacity are user preferences. Domain objects do not
/// store arbitrary visual stacking that would invalidate semantic ordering."
///
/// The architecture doc lists seven ordered layers: (1) geographic basemap,
/// (2) imported plan/image backgrounds, (3) lot and fixed structures,
/// (4) zones/beds/paths/fences, (5) plants and annotations, (6) generated
/// proposals, (7) selection/handles/measurements/validation overlays. Only
/// layers 2–5 get a case here:
/// - Layer 1 (the geographic basemap) already has its own presence/absence
///   control — `MapEditorViewModel.georeference`/`MapBackgroundView` shows or
///   hides it entirely depending on whether the garden has been georeferenced
///   — so a second, independent visibility toggle here would be redundant,
///   not a missing feature.
/// - Layer 6 (generated proposals) has no `GardenObjectCategory` in this
///   codebase yet — proposals are Phase 10 scope (docs/implementation-plan.md)
///   — so a toggle for it would have nothing to ever hide. Omitted rather
///   than built against a category that does not exist.
/// - Layer 7 (selection, handles, measurements, validation overlays) is
///   editor chrome, not user content, and is never user-toggleable.
public enum MapLayer: String, Sendable, CaseIterable, Identifiable {
    /// Layer 2: imported plan/image backgrounds. The toggle is real, but
    /// nothing in this app can create an `importedBackground` object yet
    /// (see `CreatableMapObjectCategory`'s doc comment, Phase 6 scope), so
    /// this layer has nothing to hide until that lands.
    case importedBackgrounds
    /// Layer 3: lot and fixed structures.
    case lotAndStructures
    /// Layer 4: zones, beds, paths, and fences.
    case zonesAndLinework
    /// Layer 5: plants and annotations.
    case plantsAndAnnotations

    public var id: String { rawValue }

    /// Maps a category onto the layer it belongs to.
    ///
    /// `waterFeature` and `utilityExclusion` are not named individually in
    /// the architecture doc's layer list (section "12. Layer Model" only
    /// says "zones, beds, paths, and fences") — they are assigned here to
    /// the same layer, by the same "bounded area/linework category" logic
    /// `zone`/`bed`/`fence` already occupy, since the doc does not spell out
    /// every one of the 13 categories individually.
    public init(category: GardenObjectCategory) {
        switch category {
        case .importedBackground:
            self = .importedBackgrounds
        case .lot, .structure:
            self = .lotAndStructures
        case .zone, .bed, .path, .fence, .gate, .waterFeature, .utilityExclusion:
            self = .zonesAndLinework
        case .tree, .plant, .annotation:
            self = .plantsAndAnnotations
        }
    }
}
