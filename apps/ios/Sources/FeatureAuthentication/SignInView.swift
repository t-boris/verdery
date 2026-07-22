import SwiftUI

/// Sign-in screen.
///
/// Source: architecture/ios-application-design.md, section "5.1 Presentation".
public struct SignInView: View {
    @State private var model: SignInViewModel

    public init(model: SignInViewModel) {
        _model = State(wrappedValue: model)
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text(model.title)
                .font(.title2)
                .accessibilityAddTraits(.isHeader)

            Text(model.description)
                .foregroundStyle(.secondary)

            Button(model.googleActionTitle) {
                Task { await model.signInWithGoogle() }
            }
            .buttonStyle(.borderedProminent)
            .accessibilityIdentifier("auth.signIn.google")

            Divider()

            emailSection

            if case let .failed(message) = model.state {
                Text(message)
                    .foregroundStyle(.red)
                    .accessibilityIdentifier("auth.signIn.failure")
            }
        }
        .padding()
    }

    @ViewBuilder
    private var emailSection: some View {
        if model.state == .emailLinkSent {
            VStack(alignment: .leading, spacing: 4) {
                Text(model.emailSentTitle).font(.headline)
                Text(model.emailSentDescription).foregroundStyle(.secondary)
            }
            .accessibilityIdentifier("auth.signIn.emailSent")
        } else {
            VStack(alignment: .leading, spacing: 8) {
                TextField(model.emailLabel, text: $model.email)
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.emailAddress)
                    #endif
                    .textFieldStyle(.roundedBorder)
                    .accessibilityIdentifier("auth.signIn.emailField")

                Button(model.emailSubmitTitle) {
                    Task { await model.sendEmailSignInLink() }
                }
                .disabled(model.state == .signingIn)
                .accessibilityIdentifier("auth.signIn.emailSubmit")
            }
        }
    }
}
