import CoreDesignSystem
import SwiftUI

/// The account screen: who is signed in, what this build is, and the way out.
///
/// It exists because the application had no way to sign out at all — the
/// gateway method and the `shell.signOut` string were both written and never
/// wired to a view, which a TestFlight reader found the hard way.
///
/// Built as one identity card of chips over a row of figure tiles rather than
/// as a settings form: a labelled row per fact would be four lines of prose
/// where a symbol and a word already say it, and this screen has very little
/// to say. Nothing here is a placeholder — every element rendered has a source
/// behind it, and an absent source draws nothing.
///
/// Source: architecture/ios-application-design.md, section "5.1 Presentation".
public struct ProfileView: View {
    @State private var model: ProfileViewModel
    @State private var isSignOutConfirmationPresented = false
    @State private var isDeletePresented = false
    /// Injected rather than built here: the deletion model needs a teardown
    /// closure only the composition root can write, and this feature must not
    /// learn about databases or media files.
    private let makeDeleteModel: (() -> DeleteAccountViewModel)?

    public init(
        model: ProfileViewModel,
        makeDeleteModel: (() -> DeleteAccountViewModel)? = nil
    ) {
        _model = State(wrappedValue: model)
        self.makeDeleteModel = makeDeleteModel
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Metrics.space5) {
                identityCard
                aboutSection
                signOutSection
                deleteAccountSection
            }
            .padding(Metrics.space4)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .navigationTitle(model.title)
        .inlineNavigationTitle()
        .screenBackground()
    }

    private var identityCard: some View {
        SurfaceCard {
            VStack(alignment: .leading, spacing: Metrics.space3) {
                HStack(alignment: .top, spacing: Metrics.space3) {
                    IconMedallion(
                        symbol: "person.crop.circle.fill",
                        label: model.title,
                        isLarge: true
                    )

                    VStack(alignment: .leading, spacing: Metrics.space1) {
                        Text(model.headline)
                            .font(Typography.heading)
                            .foregroundStyle(Palette.text)
                            .accessibilityIdentifier("profile.headline")

                        if let emailAddress = model.emailAddress {
                            Text(emailAddress)
                                .font(Typography.detail)
                                .foregroundStyle(Palette.textMuted)
                                .accessibilityIdentifier("profile.email")
                        }
                    }
                }

                if !model.badges.isEmpty {
                    // Wraps rather than truncates: a reader at an accessibility
                    // text size gets two rows of chips, not one clipped row.
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: Metrics.space2) { badges }
                        VStack(alignment: .leading, spacing: Metrics.space2) { badges }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var badges: some View {
        ForEach(model.badges) { badge in
            Chip(symbol: symbol(for: badge.kind), label: badge.label, tone: tone(for: badge.kind))
        }
    }

    @ViewBuilder
    private var aboutSection: some View {
        let facts = model.facts

        if !facts.isEmpty {
            VStack(alignment: .leading, spacing: Metrics.space2) {
                SectionEyebrow(symbol: "shippingbox", title: model.aboutTitle)

                HStack(alignment: .top, spacing: Metrics.space3) {
                    ForEach(facts) { fact in
                        MetricTile(
                            symbol: symbol(for: fact.kind),
                            value: fact.value,
                            caption: fact.label,
                            tone: .neutral
                        )
                    }
                }
            }
        }
    }

    /// Apple checks that account deletion is reachable in a small number of
    /// taps. Account is one tap from the console strip on every screen; this
    /// is the second.
    @ViewBuilder
    private var deleteAccountSection: some View {
        if let makeDeleteModel {
            Button {
                isDeletePresented = true
            } label: {
                Label(model.deleteAccountTitle, systemImage: "trash")
            }
            .buttonStyle(SecondaryButtonStyle(tone: .negative))
            .accessibilityIdentifier("profile.deleteAccount")
            .sheet(isPresented: $isDeletePresented) {
                DeleteAccountView(model: makeDeleteModel()) { isDeletePresented = false }
            }
        }
    }

    private var signOutSection: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            Button {
                isSignOutConfirmationPresented = true
            } label: {
                Label(model.signOutTitle, systemImage: "rectangle.portrait.and.arrow.right")
            }
            .buttonStyle(SecondaryButtonStyle())
            .accessibilityIdentifier("profile.signOut")
            .confirmationDialog(
                model.signOutConfirmTitle,
                isPresented: $isSignOutConfirmationPresented,
                titleVisibility: .visible
            ) {
                Button(model.signOutTitle, role: .destructive) {
                    model.signOut()
                    // The session either ended or did not; the reader feels
                    // which, rather than both feeling the same.
                    Haptics.play(model.failureMessage == nil ? .warning : .failure)
                }
                Button(model.signOutCancelTitle, role: .cancel) {}
            } message: {
                Text(model.signOutConfirmMessage)
            }

            if let failureMessage = model.failureMessage {
                InlineMessage(failureMessage)
                    .accessibilityIdentifier("profile.signOut.failure")
            }
        }
    }

    /// Iconography lives here rather than in the model: a symbol is
    /// presentation, and the model's own types stay free of the design system.
    private func symbol(for kind: ProfileBadge.Kind) -> String {
        switch kind {
        case .google: "globe"
        case .apple: "apple.logo"
        case .emailLink: "envelope.fill"
        case .addressConfirmed: "checkmark.seal.fill"
        case .addressUnconfirmed: "exclamationmark.triangle.fill"
        }
    }

    private func tone(for kind: ProfileBadge.Kind) -> Tone {
        switch kind {
        // How this account signs in is a fact about it, not something to act
        // on, so the provider badges are neutral. The two address badges below
        // stay toned, because those really are states.
        case .google, .apple, .emailLink: .neutral
        case .addressConfirmed: .positive
        case .addressUnconfirmed: .warning
        }
    }

    private func symbol(for kind: ProfileFact.Kind) -> String {
        switch kind {
        case .version: "number"
        case .build: "hammer.fill"
        case .language: "character.bubble.fill"
        }
    }
}
