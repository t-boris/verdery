/// The map editor's view-rotation controls.
///
/// A key set of its own, for the structural reason ``ProfileLocalizationKey``'s
/// own doc comment gives — an enum's cases cannot be split across files, and
/// `LocalizationKey` sat at 599 lines against this repository's 600-line rule.
/// One more case there broke the gate for whoever added it, which is what
/// happened here; the answer the codebase has already chosen a dozen times is
/// another key set rather than a thinner comment.
///
/// Rotation, per architecture/map-rendering-and-editing.md section 3.2: "the
/// editor provides 15-degree clockwise/counter-clockwise steps, an exact degree
/// input, and North up".
public enum MapRotationLocalizationKey: String, Sendable, CaseIterable {
    case northUp = "map.rotation.northUp"
    case clockwise = "map.rotation.clockwise"
    case counterclockwise = "map.rotation.counterclockwise"
    case exact = "map.rotation.exact"
    case apply = "map.rotation.apply"
    case value = "map.rotation.value"
}

/// One object's own hide and lock, in the property sheet.
///
/// Beside the rotation keys for the same reason they exist at all — see this
/// file's other enum — and separate from `map.layers.*`, which name a
/// client-side toggle over a whole group rather than a persisted fact about
/// one object.
public enum MapObjectVisibilityLocalizationKey: String, Sendable, CaseIterable {
    case hide = "map.property.hide"
    case show = "map.property.show"
    case lock = "map.property.lock"
    case unlock = "map.property.unlock"
}
