import SwiftUI

/// How far a surface sits above the one behind it.
///
/// Field Console separates with hairlines, not glow: a card's boundary is its
/// `controlBorder` or `border` stroke, and elevation only exists so a rounded
/// corner has some light to describe it. ``xs`` and ``sm`` are deliberately at
/// the edge of visible for that reason; ``md`` and ``lg`` carry real weight
/// because a sheet or popover has to read as detached.
///
/// Source: apps/web/shared/ui/tokens.css, `--shadow-xs` … `--shadow-lg`.
public enum Elevation: Sendable, CaseIterable {
    /// A card resting on the canvas.
    case xs
    /// A card that can be tapped, or a row lifted out of a list.
    case sm
    /// A popover, a menu, the object puck.
    case md
    /// A sheet.
    case lg
}

extension View {
    /// Applies one elevation step.
    ///
    /// The web's shadows are two-layer — a tight contact shadow plus a wide,
    /// offset ambient one — and SwiftUI's `.shadow` is single-layer, so the
    /// two heavier steps stack two calls. Doing that arithmetic here, once,
    /// is the point: a screen that reached for `.shadow(radius:)` directly
    /// would be inventing a third elevation nobody chose.
    public func elevation(_ level: Elevation) -> some View {
        modifier(ElevationModifier(level: level))
    }
}

private struct ElevationModifier: ViewModifier {
    let level: Elevation

    func body(content: Content) -> some View {
        switch level {
        case .xs:
            content.shadow(color: .black.opacity(0.04), radius: 1, x: 0, y: 1)
        case .sm:
            content
                .shadow(color: .black.opacity(0.05), radius: 1, x: 0, y: 1)
                .shadow(color: .black.opacity(0.04), radius: 3, x: 0, y: 1)
        case .md:
            content
                .shadow(color: .black.opacity(0.06), radius: 2, x: 0, y: 2)
                .shadow(color: .black.opacity(0.18), radius: 14, x: 0, y: 8)
        case .lg:
            content
                .shadow(color: .black.opacity(0.07), radius: 4, x: 0, y: 4)
                .shadow(color: .black.opacity(0.22), radius: 24, x: 0, y: 16)
        }
    }
}
