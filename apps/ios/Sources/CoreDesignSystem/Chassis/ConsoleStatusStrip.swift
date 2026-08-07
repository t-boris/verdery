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
