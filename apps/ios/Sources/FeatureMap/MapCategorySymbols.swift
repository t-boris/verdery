import CoreDomain

/// A symbol per object category.
///
/// `map-rendering-and-editing.md` section 18.3 requires every category to
/// carry a colour *and* an icon, so that a reader who cannot distinguish two
/// tints still tells a bed from a path. The canvas has had the colours;
/// this is the other half, and the property editor is its first caller.
enum MapCategorySymbols {
    static func symbol(for category: GardenObjectCategory) -> String {
        switch category {
        case .lot: "map"
        case .structure: "house"
        case .fence: "square.split.bottomrightquarter"
        case .gate: "door.left.hand.open"
        case .path: "point.topleft.down.to.point.bottomright.curvepath"
        case .zone: "square.dashed"
        case .bed: "rectangle.grid.1x2"
        case .waterFeature: "drop"
        case .utilityExclusion: "exclamationmark.triangle"
        case .tree: "tree"
        case .plant: "leaf"
        case .annotation: "text.bubble"
        case .importedBackground: "photo"
        }
    }
}
