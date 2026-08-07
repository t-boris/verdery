import SwiftUI

/// A raised block of content on the canvas.
///
/// Replaces the grouped-`List` sections the screens used to be built from.
/// A `Form` row communicates "this is a setting"; a card communicates "this is
/// a thing" — which is what a plant, a task, or a recommendation actually is.
public struct SurfaceCard<Content: View>: View {
    private let tone: Tone?
    private let content: Content

    public init(tone: Tone? = nil, @ViewBuilder content: () -> Content) {
        self.tone = tone
        self.content = content()
    }

    public var body: some View {
        content
            .padding(Metrics.space3)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: Metrics.radiusCard, style: .continuous)
                    .fill(tone?.quietFill ?? Palette.surface)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Metrics.radiusCard, style: .continuous)
                    .strokeBorder(Palette.border, lineWidth: Metrics.hairline)
            )
    }
}

/// The page background every screen sits on.
///
/// The warm paper canvas rather than the system's grouped-table grey, which is
/// what makes the app read as this product rather than as a settings bundle.
///
/// Three simulator screenshots settled the shape of this modifier, in order:
///
/// 1. A plain `.background(_:)` is sized to the content behind it, so a screen
///    whose content did not fill the window — an empty state, a failure state —
///    painted a canvas-coloured *band* across a white window.
/// 2. Wrapping the screen in a `ZStack` fixed the band and cost every scrolling
///    screen its large navigation title: the bar no longer recognised the
///    scroll view underneath it.
/// 3. Painting the canvas once at the window root left the tab bar's own
///    opaque backdrop showing through as white.
///
/// What works is the frame below. `maxWidth`/`maxHeight: .infinity` is a no-op
/// for a `List` or a `ScrollView`, which are already greedy — so the navigation
/// bar still sees one as its direct descendant and keeps the large title — and
/// it is exactly what a short empty state needs in order to fill the window.
public struct ScreenBackground: ViewModifier {
    public init() {}

    public func body(content: Content) -> some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Palette.canvas.ignoresSafeArea())
            .scrollContentBackground(.hidden)
            #if os(iOS)
                .toolbarBackground(Palette.canvas, for: .navigationBar)
            #endif
    }
}

extension View {
    public func screenBackground() -> some View {
        modifier(ScreenBackground())
    }

    /// A compact navigation title, on the platforms that have one.
    ///
    /// `navigationBarTitleDisplayMode` is unavailable on macOS, which this
    /// package still builds for so `swift test` runs headlessly. The `#if` is
    /// resolved at compile time, so `some View` still names one concrete type
    /// in each build.
    public func inlineNavigationTitle() -> some View {
        #if os(iOS)
        return navigationBarTitleDisplayMode(.inline)
        #else
        return self
        #endif
    }
}

/// A small uppercase eyebrow that names a group of cards.
///
/// Carries a symbol of its own so a scrolling reader locates a section by
/// shape before reading its name.
public struct SectionEyebrow: View {
    private let symbol: String
    private let title: String

    public init(symbol: String, title: String) {
        self.symbol = symbol
        self.title = title
    }

    public var body: some View {
        HStack(spacing: Metrics.space2) {
            Image(systemName: symbol)
                .font(Typography.eyebrow)
                .imageScale(.small)
            Text(title.uppercased())
                .font(Typography.eyebrow)
                .kerning(1.2)
            Rectangle()
                .fill(Palette.border)
                .frame(height: Metrics.hairline)
        }
        .foregroundStyle(Palette.textMuted)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title)
        .accessibilityAddTraits(.isHeader)
    }
}

/// A large figure with a symbol and a caption — the graphical form of a number
/// that used to be a sentence.
public struct MetricTile: View {
    private let symbol: String
    private let value: String
    private let caption: String
    private let tone: Tone

    // A figure is a fact, so the default tone is neutral; a tile that means
    // something — an overdue count, a healthy count — says so explicitly.
    public init(symbol: String, value: String, caption: String, tone: Tone = .neutral) {
        self.symbol = symbol
        self.value = value
        self.caption = caption
        self.tone = tone
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: Metrics.space1) {
            Image(systemName: symbol)
                .font(Typography.detail)
                .imageScale(.medium)
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(tone.foreground)
            Text(value)
                .font(Typography.metric)
                .foregroundStyle(Palette.text)
            Text(caption)
                .font(Typography.micro)
                .foregroundStyle(Palette.textMuted)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Metrics.space3)
        .background(
            RoundedRectangle(cornerRadius: Metrics.radiusCard, style: .continuous)
                .fill(tone.quietFill)
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(caption): \(value)")
    }
}
