import Foundation

/// One bundled typeface: the file it ships as, and the name it is addressed by.
///
/// These two strings are not derivable from each other. IBM Plex Sans
/// abbreviates two of its PostScript names — `IBMPlexSans-Medm` and
/// `IBMPlexSans-SmBld` — and its Regular face drops the style entirely, to
/// plain `IBMPlexSans`. Asking `Font.custom` for a name that does not exist
/// does not raise: CoreText substitutes the system font and the screen simply
/// looks slightly wrong, in one weight, possibly only in one language. That is
/// why the pairs are written down here once and asserted against the real
/// files by `Tests/CoreDesignSystemTests/FontRegistrationTests.swift`.
///
/// Source: Sources/CoreDesignSystem/Resources/Fonts/NOTICE.md.
public enum FontFace: String, Sendable, CaseIterable {
    case sansRegular = "IBMPlexSans"
    case sansMedium = "IBMPlexSans-Medm"
    case sansSemiBold = "IBMPlexSans-SmBld"
    case sansBold = "IBMPlexSans-Bold"
    case monoRegular = "IBMPlexMono-Regular"
    case monoMedium = "IBMPlexMono-Medium"
    case monoSemiBold = "IBMPlexMono-SemiBold"

    /// The name CoreText knows this face by, once registered.
    public var postScriptName: String { rawValue }

    /// The bundled file, without its extension.
    public var fileName: String {
        switch self {
        case .sansRegular: "IBMPlexSans-Regular"
        case .sansMedium: "IBMPlexSans-Medium"
        case .sansSemiBold: "IBMPlexSans-SemiBold"
        case .sansBold: "IBMPlexSans-Bold"
        case .monoRegular: "IBMPlexMono-Regular"
        case .monoMedium: "IBMPlexMono-Medium"
        case .monoSemiBold: "IBMPlexMono-SemiBold"
        }
    }
}
