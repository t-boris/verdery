import SwiftUI

/// One entry in the type scale: a face, a base size, and the system text style
/// whose growth curve it follows.
///
/// A value type rather than a bare `Font` so the scale is *readable* — the
/// table can be asserted in a test, and a drift between a size and the token it
/// came from fails there instead of only being visible on a screen nobody
/// screenshots at accessibility text sizes.
public struct TypeStyle: Sendable, Equatable {
    public let face: FontFace
    public let size: CGFloat
    /// The system style this scales against. `Font.custom(_:size:relativeTo:)`
    /// is the supported Dynamic Type path for a bundled face: the system
    /// scales `size` by the named style's metrics, exactly as `.font(.body)`
    /// scales its own. The overload WITHOUT `relativeTo:` is a permanently
    /// fixed size and must never be used — it looks identical at a glance and
    /// silently ignores the reader's text size.
    public let relativeTo: Font.TextStyle

    public init(_ face: FontFace, _ size: CGFloat, relativeTo: Font.TextStyle) {
        self.face = face
        self.size = size
        self.relativeTo = relativeTo
    }

    /// Registering on first use, rather than requiring the application to
    /// remember: a `static let` runs exactly once, is thread-safe, and costs a
    /// load thereafter, so no call site has to know the fonts are bundled.
    private static let ensureRegistered: Void = {
        Fonts.register()
    }()

    public var font: Font {
        Self.ensureRegistered
        return .custom(face.postScriptName, size: size, relativeTo: relativeTo)
    }
}

/// The base sizes, carried over from `apps/web/shared/ui/tokens.css`.
///
/// One deliberate divergence: the web's `--font-size-md` is `0.9375rem`, 15 CSS
/// pixels, and body here is **16**. A CSS pixel read at laptop distance and an
/// iOS point read at arm's length are not the same perceived size; iOS's own
/// `.body` default is 17; and this product states an outdoor-legibility
/// requirement that argues against being two points under the platform norm.
/// The rest of the scale is the web's, converted at a 16px root.
public enum TypeScale {
    /// `--font-size-xs`, 0.6875rem.
    public static let xs: CGFloat = 11
    /// `--font-size-sm`, 0.8125rem.
    public static let sm: CGFloat = 13
    /// `--font-size-md`, 0.9375rem on the web; see the note above.
    public static let md: CGFloat = 16
    /// `--font-size-lg`, 1.0625rem.
    public static let lg: CGFloat = 17
    /// `--font-size-xl`, 1.25rem.
    public static let xl: CGFloat = 20
    /// `--font-size-2xl`, 1.5rem.
    public static let xxl: CGFloat = 24
    /// `--label-size`, 0.625rem — the mono uppercase label, one declaration.
    public static let label: CGFloat = 10
}
