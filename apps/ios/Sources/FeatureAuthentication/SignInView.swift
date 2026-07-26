import CoreDesignSystem
import SwiftUI

/// Sign-in screen — the first thing anyone sees, and until this pass a stack
/// of default-styled system buttons on white.
///
/// It now opens on the product's own identity: the wordmark in the display
/// serif over a large tree glyph on the warm paper canvas, then the three
/// methods, each led by its own symbol. The email field takes focus only when
/// the reader taps into it, and the keyboard's Go key sends the link, so the
/// email path is type-and-return rather than type-reach-tap.
///
/// A signing-in state now shows: all three controls disable and the one that
/// was tapped shows a spinner, so a flow that opens a browser (Google) or a
/// system sheet (Apple) does not look like a control that did nothing.
///
/// Source: architecture/ios-application-design.md, section "5.1 Presentation";
/// work package P8-UX-01.
public struct SignInView: View {
    @State private var model: SignInViewModel
    @FocusState private var isEmailFocused: Bool

    public init(model: SignInViewModel) {
        _model = State(wrappedValue: model)
    }

    private var isBusy: Bool { model.state == .signingIn }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Metrics.space5) {
                wordmark
                providerButtons
                separator
                emailSection

                if case let .failed(message) = model.state {
                    InlineMessage(message)
                        .accessibilityIdentifier("auth.signIn.failure")
                }
            }
            .padding(Metrics.space5)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .screenBackground()
    }

    private var wordmark: some View {
        VStack(alignment: .leading, spacing: Metrics.space3) {
            Image(systemName: "tree.fill")
                .font(Typography.display)
                .imageScale(.large)
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(Palette.accent)
                .accessibilityHidden(true)

            Text(model.title)
                .font(Typography.display)
                .foregroundStyle(Palette.text)
                .accessibilityAddTraits(.isHeader)

            Text(model.description)
                .font(Typography.secondary)
                .foregroundStyle(Palette.textMuted)
        }
        .padding(.top, Metrics.space6)
    }

    private var providerButtons: some View {
        VStack(spacing: Metrics.space3) {
            Button {
                Task { await model.signInWithGoogle() }
            } label: {
                Label(model.googleActionTitle, systemImage: "globe")
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(isBusy)
            .accessibilityIdentifier("auth.signIn.google")

            Button {
                Task { await model.signInWithApple() }
            } label: {
                Label(model.appleActionTitle, systemImage: "apple.logo")
            }
            .buttonStyle(SecondaryButtonStyle())
            .disabled(isBusy)
            .accessibilityIdentifier("auth.signIn.apple")

            if isBusy {
                ProgressView()
                    .tint(Palette.accent)
            }
        }
    }

    private var separator: some View {
        Rectangle()
            .fill(Palette.border)
            .frame(height: Metrics.hairline)
            .accessibilityHidden(true)
    }

    @ViewBuilder
    private var emailSection: some View {
        if model.state == .emailLinkSent {
            SurfaceCard(tone: .positive) {
                HStack(alignment: .top, spacing: Metrics.space3) {
                    IconMedallion(
                        symbol: "envelope.badge.fill",
                        label: model.emailSentTitle,
                        tone: .positive
                    )
                    VStack(alignment: .leading, spacing: Metrics.space1) {
                        Text(model.emailSentTitle)
                            .font(Typography.heading)
                            .foregroundStyle(Palette.text)
                        Text(model.emailSentDescription)
                            .font(Typography.detail)
                            .foregroundStyle(Palette.textMuted)
                    }
                }
            }
            .accessibilityIdentifier("auth.signIn.emailSent")
        } else {
            VStack(alignment: .leading, spacing: Metrics.space3) {
                HStack(spacing: Metrics.space2) {
                    Image(systemName: "envelope.fill")
                        .foregroundStyle(Palette.textMuted)
                        .accessibilityHidden(true)

                    TextField(model.emailLabel, text: $model.email)
                        #if os(iOS)
                            .textInputAutocapitalization(.never)
                            .keyboardType(.emailAddress)
                            .textContentType(.emailAddress)
                        #endif
                        .autocorrectionDisabled()
                        .textFieldStyle(.roundedBorder)
                        .focused($isEmailFocused)
                        .submitLabel(.go)
                        .onSubmit(sendLink)
                        .accessibilityIdentifier("auth.signIn.emailField")
                }

                Button(action: sendLink) {
                    Label(model.emailSubmitTitle, systemImage: "paperplane.fill")
                }
                .buttonStyle(SecondaryButtonStyle())
                .disabled(isBusy || model.email.trimmingCharacters(in: .whitespaces).isEmpty)
                .accessibilityIdentifier("auth.signIn.emailSubmit")
            }
        }
    }

    private func sendLink() {
        guard !model.email.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        isEmailFocused = false
        Task { await model.sendEmailSignInLink() }
    }
}
