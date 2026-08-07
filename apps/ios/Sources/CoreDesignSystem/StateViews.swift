import SwiftUI

/// What a screen shows when it has nothing to show.
///
/// An empty state that only states emptiness wastes the one moment the reader
/// is most receptive to being told what to do. This one is a large symbol, a
/// sentence, and — always, when the screen has one — the action that ends the
/// emptiness.
public struct EmptyStateView: View {
    private let symbol: String
    private let title: String
    private let message: String?
    private let actionTitle: String?
    private let actionSymbol: String
    private let action: (() -> Void)?

    public init(
        symbol: String,
        title: String,
        message: String? = nil,
        actionTitle: String? = nil,
        actionSymbol: String = "plus",
        action: (() -> Void)? = nil
    ) {
        self.symbol = symbol
        self.title = title
        self.message = message
        self.actionTitle = actionTitle
        self.actionSymbol = actionSymbol
        self.action = action
    }

    public var body: some View {
        VStack(spacing: Metrics.space3) {
            Image(systemName: symbol)
                .font(.largeTitle)
                .imageScale(.large)
                .symbolRenderingMode(.hierarchical)
                // Muted ink, not the interaction colour: this glyph is an
                // illustration — it is `accessibilityHidden`, it cannot be
                // tapped, and the action button below it is what the reader is
                // meant to reach for. Nor is it `positive`: an empty list is
                // not a success.
                .foregroundStyle(Palette.textMuted)
                .accessibilityHidden(true)

            Text(title)
                .font(FieldConsoleType.title.font)
                .foregroundStyle(Palette.text)
                .multilineTextAlignment(.center)

            if let message {
                Text(message)
                    .font(FieldConsoleType.secondary.font)
                    .foregroundStyle(Palette.textMuted)
                    .multilineTextAlignment(.center)
            }

            if let actionTitle, let action {
                Button(action: action) {
                    Label(actionTitle, systemImage: actionSymbol)
                }
                .buttonStyle(PrimaryButtonStyle())
            }
        }
        .frame(maxWidth: .infinity)
        .padding(Metrics.space5)
    }
}

/// A failure the reader can act on: a symbol, the message, and a retry.
public struct FailureStateView: View {
    private let message: String
    private let retryTitle: String?
    private let retry: (() -> Void)?

    public init(message: String, retryTitle: String? = nil, retry: (() -> Void)? = nil) {
        self.message = message
        self.retryTitle = retryTitle
        self.retry = retry
    }

    public var body: some View {
        VStack(spacing: Metrics.space3) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.largeTitle)
                .imageScale(.large)
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(Palette.warning)
                .accessibilityHidden(true)

            Text(message)
                .font(FieldConsoleType.body.font)
                .foregroundStyle(Palette.text)
                .multilineTextAlignment(.center)

            if let retryTitle, let retry {
                Button(action: retry) {
                    Label(retryTitle, systemImage: "arrow.clockwise")
                }
                .buttonStyle(SecondaryButtonStyle())
            }
        }
        .frame(maxWidth: .infinity)
        .padding(Metrics.space5)
    }
}

/// An inline message attached to a control that just failed, or to a field
/// that is not yet valid.
///
/// Tone plus symbol, never tone alone.
public struct InlineMessage: View {
    private let message: String
    private let tone: Tone

    public init(_ message: String, tone: Tone = .negative) {
        self.message = message
        self.tone = tone
    }

    private var symbol: String {
        switch tone {
        case .negative: "exclamationmark.circle.fill"
        case .warning: "exclamationmark.triangle.fill"
        case .positive: "checkmark.circle.fill"
        case .neutral: "info.circle.fill"
        }
    }

    public var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: Metrics.space2) {
            Image(systemName: symbol)
                .font(FieldConsoleType.detail.font)
                .imageScale(.medium)
                .accessibilityHidden(true)
            Text(message)
                .font(FieldConsoleType.detail.font)
        }
        .foregroundStyle(tone.foreground)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The in-place loading state: a spinner and a line of text, centred.
public struct LoadingStateView: View {
    private let message: String

    public init(_ message: String) {
        self.message = message
    }

    public var body: some View {
        VStack(spacing: Metrics.space3) {
            ProgressView()
                // The one place a non-control wears the interaction colour:
                // a spinner is the application working on the reader's behalf,
                // and `tint` is what SwiftUI asks for. It is also transient,
                // so it cannot accumulate into a screen full of orange.
                .tint(Palette.interaction)
            Text(message)
                .font(FieldConsoleType.detail.font)
                .foregroundStyle(Palette.textMuted)
        }
        .frame(maxWidth: .infinity)
        .padding(Metrics.space5)
    }
}
