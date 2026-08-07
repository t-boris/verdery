import SwiftUI

/// The one search control, replacing four hand-rolled field-and-magnifier rows.
///
/// A capsule, because a search box is the one field people already recognise
/// by shape. There is no submit button: typing searches, after a short pause.
///
/// `.searchable` is deliberately not used. It hands placement to the
/// navigation bar — the chrome Field Console replaces — and its scope bar is a
/// system segmented control. What it does give away for free is
/// keyboard-dismiss-on-scroll, which the enclosing scroll view restores with
/// `.scrollDismissesKeyboard(.interactively)`.
public struct SearchStrip: View {
    private let accessibilityName: String
    private let placeholder: String
    private let clearLabel: String
    @Binding private var query: String
    /// Fired after the reader stops typing, not on every keystroke.
    private let search: (String) async -> Void

    @FocusState private var isFocused: Bool
    @ScaledSize(Metrics.minimumTouchTarget) private var controlHeight

    /// Long enough that a four-letter word is one request rather than four,
    /// short enough that the results feel like a consequence of typing.
    private static let debounce = Duration.milliseconds(250)

    public init(
        accessibilityName: String,
        placeholder: String,
        clearLabel: String,
        query: Binding<String>,
        search: @escaping (String) async -> Void
    ) {
        self.accessibilityName = accessibilityName
        self.placeholder = placeholder
        self.clearLabel = clearLabel
        _query = query
        self.search = search
    }

    public var body: some View {
        HStack(spacing: Metrics.space2) {
            Image(systemName: "magnifyingglass")
                .imageScale(.medium)
                .foregroundStyle(Palette.textMuted)
                .accessibilityHidden(true)

            TextField(placeholder, text: $query)
                .textFieldStyle(.plain)
                .font(FieldConsoleType.body.font)
                .foregroundStyle(Palette.text)
                .focused($isFocused)
                .submitLabel(.search)
                .autocorrectionDisabled()
                .withoutAutocapitalization()
                .accessibilityLabel(accessibilityName)

            if !query.isEmpty {
                Button {
                    query = ""
                    isFocused = true
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .imageScale(.medium)
                        .foregroundStyle(Palette.textMuted)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(clearLabel)
            }
        }
        .padding(.horizontal, Metrics.space3)
        .frame(minHeight: controlHeight)
        .background(
            Capsule(style: .continuous)
                .fill(Palette.surfaceSunken)
        )
        .overlay(
            Capsule(style: .continuous)
                .strokeBorder(Palette.controlBorder, lineWidth: Metrics.hairline)
        )
        .overlay(focusRing)
        // Keyed on the query, so a new keystroke cancels the pending sleep and
        // starts a fresh one — a debounce with no timer to own or leak.
        .task(id: query) {
            try? await Task.sleep(for: Self.debounce)
            guard !Task.isCancelled else { return }
            await search(query)
        }
    }

    @ViewBuilder
    private var focusRing: some View {
        if isFocused {
            Capsule(style: .continuous)
                .strokeBorder(Palette.focus, lineWidth: Metrics.focusRingWidth)
                .padding(-Metrics.focusRingOffset)
        }
    }
}

extension View {
    /// `textInputAutocapitalization` is UIKit-backed and absent from the
    /// headless macOS build this package also compiles for, so it is applied
    /// through a `#if` the same way `inlineNavigationTitle()` handles
    /// `navigationBarTitleDisplayMode`.
    fileprivate func withoutAutocapitalization() -> some View {
        #if os(iOS)
        return textInputAutocapitalization(.never)
        #else
        return self
        #endif
    }
}
