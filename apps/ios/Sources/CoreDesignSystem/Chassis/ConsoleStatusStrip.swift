import SwiftUI

/// The permanent 24-point strip that sits directly on the tab bar.
///
/// Together they read as one charcoal instrument panel under a warm paper
/// worktop, which is the strongest statement the Field Console language makes
/// on a phone. The strip carries the two questions a person has on every
/// screen and neither tab bar nor navigation bar answers: *which garden am I
/// in* and *is my work safe*.
///
/// It also buys back space. Both of those used to be toolbar buttons repeated
/// on all five tabs; moving them here leaves each screen's navigation bar to
/// that screen's own title and actions.
///
/// Domain-free by construction: the garden's name and the status label arrive
/// already resolved, so this file needs neither `CoreDomain` nor
/// `CoreLocalization`.
public struct ConsoleStatusStrip: View {
    private let gardenName: String
    private let gardenSymbol: String
    private let status: ConsoleStatus
    private let accountInitials: String
    private let accountLabel: String
    private let openGardens: () -> Void
    private let openStatus: () -> Void
    private let openAccount: () -> Void

    @ScaledSize(Metrics.statusStripHeight, relativeTo: .caption2) private var stripHeight
    @ScaledSize(Metrics.space5, relativeTo: .caption2) private var avatarSize

    public init(
        gardenName: String,
        gardenSymbol: String,
        status: ConsoleStatus,
        accountInitials: String,
        accountLabel: String,
        openGardens: @escaping () -> Void,
        openStatus: @escaping () -> Void,
        openAccount: @escaping () -> Void
    ) {
        self.gardenName = gardenName
        self.gardenSymbol = gardenSymbol
        self.status = status
        self.accountInitials = accountInitials
        self.accountLabel = accountLabel
        self.openGardens = openGardens
        self.openStatus = openStatus
        self.openAccount = openAccount
    }

    public var body: some View {
        HStack(spacing: Metrics.space2) {
            Button(action: openGardens) {
                HStack(spacing: Metrics.space1) {
                    Image(systemName: gardenSymbol)
                        .imageScale(.small)
                    Text(gardenName)
                        .lineLimit(1)
                    Image(systemName: "chevron.up.chevron.down")
                        .imageScale(.small)
                }
                .font(FieldConsoleType.label.font)
                .textCase(.uppercase)
                .foregroundStyle(Palette.consoleText)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(gardenName)
            .accessibilityIdentifier("console.status.garden")

            Spacer(minLength: Metrics.space2)

            statusReadout

            // "Who am I" belongs beside "where am I", which is what took both
            // of these out of every tab's navigation bar.
            Button(action: openAccount) {
                Text(accountInitials)
                    .font(FieldConsoleType.label.font)
                    .foregroundStyle(Palette.consoleText)
                    .frame(width: avatarSize, height: avatarSize)
                    .background(Circle().fill(Palette.consoleSelected))
                    .overlay(
                        Circle().strokeBorder(Palette.consoleBorder, lineWidth: Metrics.hairline)
                    )
            }
            .buttonStyle(.plain)
            .accessibilityLabel(accountLabel)
            .accessibilityIdentifier("console.status.account")
        }
        .padding(.horizontal, Metrics.space3)
        .frame(minHeight: stripHeight)
        .background(Palette.console)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(Palette.consoleBorder)
                .frame(height: Metrics.hairline)
        }
    }

    @ViewBuilder
    private var statusReadout: some View {
        let readout = HStack(spacing: Metrics.space1) {
            Image(systemName: status.level.symbol)
                .imageScale(.small)
            Text(status.label)
                .lineLimit(1)
            if let count = status.count, count > 0 {
                Text(String(count))
                    // A pending count changes while a person is looking at it,
                    // and a proportional face would shift the whole strip when
                    // it did. Monospaced digits keep it still.
                    .monospacedDigit()
                    .contentTransition(.numericText())
            }
        }
        .font(FieldConsoleType.label.font)
        .textCase(.uppercase)
        .foregroundStyle(foreground)

        // Only `attention` opens anything, so only `attention` is a button —
        // a control that does nothing is worse than no control.
        if status.isActionable {
            Button(action: openStatus) { readout }
                .buttonStyle(.plain)
                .accessibilityIdentifier("console.status.sync")
        } else {
            readout
                .accessibilityIdentifier("console.status.sync")
        }
    }

    /// The chassis is charcoal in both appearances, so a foreground on it is
    /// always a light-on-dark problem: the content palette's tones are chosen
    /// against paper and would fail here. `consoleAccent` and `consoleMuted`
    /// are the two that were measured against this surface.
    private var foreground: Color {
        status.level == .attention ? Palette.consoleAccent : Palette.consoleMuted
    }
}

extension View {
    /// Puts a strip in the slot immediately above a `TabView`'s tab bar.
    ///
    /// A bottom safe-area inset on the `TabView` is the pre-iOS 26 way to do
    /// this, and it used to be right: the tab bar was opaque, part of the
    /// `TabView`'s own safe area, and an inset landed above it. iOS 26's tab
    /// bar floats over the content instead, so the same inset lands at the
    /// bottom of the screen — **on top of the tab bar**, hiding its lower half.
    /// That is what shipped, and only running the app could have found it: the
    /// code reads correctly and compiles either way.
    ///
    /// `tabViewBottomAccessory` is the slot iOS 26 introduced for exactly this
    /// content, so the strip goes there when it exists and stays on the inset
    /// before it. Deliberately not a hand-computed bottom padding: the floating
    /// bar's height is Apple's to change.
    ///
    /// The accessory draws the strip inside the system's own glass tray rather
    /// than edge to edge. Sizing the content to fill the tray was tried and
    /// does not take — the tray proposes an unspecified height, against which
    /// both `maxHeight: .infinity` and `containerRelativeFrame` resolve back to
    /// the content's ideal size. Accepted rather than fought: the strip in its
    /// tray above the tab bar in its own reads as the pair it is, and the
    /// alternative — insetting each tab instead of the `TabView` — was tried
    /// too and is worse, because the strip's charcoal then fills the whole
    /// bottom of the screen and the glass tab bar over it loses its labels.
    ///
    /// Applies to the `TabView` itself, not to each tab — the strip belongs to
    /// the shell, and one placement cannot drift from another.
    @ViewBuilder
    public func tabBarAccessory<Content: View>(@ViewBuilder _ content: @escaping () -> Content) -> some View {
        #if os(iOS)
            if #available(iOS 26.0, *) {
                tabViewBottomAccessory(content: content)
            } else {
                safeAreaInset(edge: .bottom, content: content)
            }
        #else
            safeAreaInset(edge: .bottom, content: content)
        #endif
    }
}
