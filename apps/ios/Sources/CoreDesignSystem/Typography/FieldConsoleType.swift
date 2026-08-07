import SwiftUI

/// The named type styles of the Field Console language.
///
/// Two families, both bundled: **IBM Plex Sans** for anything a person reads as
/// prose, **IBM Plex Mono** for anything a machine produced — a count, a
/// measurement, a timestamp, a status word, the small uppercase label that
/// heads a group. The split is semantic, not decorative: a number that changes
/// under a `.contentTransition(.numericText())` must not reflow the row it sits
/// in, and a monospaced face is what guarantees that.
///
/// Headings are the same family as body copy, differentiated by size and
/// weight rather than by a second face. The web retired its separate display
/// serif for exactly this reason and kept `--font-family-display` pointing at
/// the sans stack.
///
/// Every style goes through ``TypeStyle``, so every one scales with Dynamic
/// Type and none of them can be a fixed point size.
///
/// Source: apps/web/shared/ui/tokens.css, section "Type";
/// architecture/ios-application-design.md, section "5. Layer Responsibilities".
public enum FieldConsoleType {
    // MARK: - Prose

    /// A screen's own name, used once per screen at most.
    public static let display = TypeStyle(.sansBold, TypeScale.xxl, relativeTo: .title2)
    /// A card or section title.
    public static let title = TypeStyle(.sansSemiBold, TypeScale.xl, relativeTo: .title3)
    /// A row's leading line — the thing you scan a list by.
    public static let heading = TypeStyle(.sansSemiBold, TypeScale.lg, relativeTo: .callout)
    /// Body copy.
    public static let body = TypeStyle(.sansRegular, TypeScale.md, relativeTo: .body)
    /// Body copy carrying emphasis, without changing size.
    public static let bodyStrong = TypeStyle(.sansMedium, TypeScale.md, relativeTo: .body)
    /// Supporting copy: a subtitle, an explanation under a control.
    public static let secondary = TypeStyle(.sansRegular, TypeScale.sm, relativeTo: .footnote)
    /// The smallest prose the interface uses — a caption, an attribution.
    public static let detail = TypeStyle(.sansRegular, TypeScale.xs, relativeTo: .caption2)

    // MARK: - Machine output

    /// A measured or counted value inline in prose.
    public static let mono = TypeStyle(.monoRegular, TypeScale.sm, relativeTo: .footnote)
    /// The same, carrying emphasis — a status word, a pending count.
    public static let monoStrong = TypeStyle(.monoMedium, TypeScale.sm, relativeTo: .footnote)
    /// A figure presented as the point of its card.
    public static let metric = TypeStyle(.monoSemiBold, TypeScale.xl, relativeTo: .title3)
    /// The largest figure — a single headline number.
    public static let metricLarge = TypeStyle(.monoSemiBold, TypeScale.xxl, relativeTo: .title2)

    /// The 10pt mono uppercase label that heads a group.
    ///
    /// One declaration, in one place, mirroring the web's rule that its
    /// `<Label>` primitive is the only home for the size/tracking/case trio.
    /// The uppercasing belongs to the *view* modifier via `.textCase(.uppercase)`
    /// rather than to the string, so the accessible name a reader hears stays
    /// the natural sentence.
    public static let label = TypeStyle(.monoMedium, TypeScale.label, relativeTo: .caption2)
}
