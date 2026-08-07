import SwiftUI

/// One short thing being typed, and the action that commits it.
///
/// The iOS translation of the web's command composer: a contextual symbol, a
/// bare field, and an explicit commit share ONE control, instead of a labelled
/// row above a separate button. A garden is named this way, and so is a plant,
/// a map object, an invitation address.
///
/// There is no visible label. The placeholder names the field, the symbol
/// reinforces it, and `accessibilityLabel` carries the full name for a reader
/// who cannot see either — which is the whole difference between "form-free"
/// and "unlabelled".
///
/// The hairline is not decoration. A field has no fill of its own, so its
/// boundary IS the information identifying it as a control, which is why it
/// uses ``Palette/controlBorder`` (held at 3:1, WCAG 2.2 SC 1.4.11) rather
/// than the decorative ``Palette/border``.
///
/// Source: apps/web/features/gardens/create-garden-form.tsx;
/// architecture/web-application-design.md, section "5. Application Structure".
public struct ComposerField: View {
    private let symbol: String
    private let accessibilityName: String
    private let placeholder: String
    private let commitLabel: String
    private let commitSymbol: String
    @Binding private var text: String
    private let isBusy: Bool
    private let commit: () -> Void

    @FocusState private var isFocused: Bool
    @ScaledSize(Metrics.minimumTouchTarget) private var controlHeight

    public init(
        symbol: String,
        accessibilityName: String,
        placeholder: String,
        commitLabel: String,
        commitSymbol: String = "arrow.turn.down.left",
        text: Binding<String>,
        isBusy: Bool = false,
        commit: @escaping () -> Void
    ) {
        self.symbol = symbol
        self.accessibilityName = accessibilityName
        self.placeholder = placeholder
        self.commitLabel = commitLabel
        self.commitSymbol = commitSymbol
        _text = text
        self.isBusy = isBusy
        self.commit = commit
    }

    private var isEmpty: Bool {
        text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    public var body: some View {
        HStack(spacing: Metrics.space2) {
            Image(systemName: symbol)
                .font(FieldConsoleType.body.font)
                .imageScale(.medium)
                .foregroundStyle(Palette.textMuted)
                .accessibilityHidden(true)

            TextField(placeholder, text: $text)
                .textFieldStyle(.plain)
                .font(FieldConsoleType.body.font)
                .foregroundStyle(Palette.text)
                .focused($isFocused)
                .submitLabel(.done)
                .onSubmit { if !isEmpty { commit() } }
                .accessibilityLabel(accessibilityName)

            commitButton
        }
        .padding(.horizontal, Metrics.space3)
        .frame(minHeight: controlHeight)
        .background(
            RoundedRectangle(cornerRadius: Metrics.radiusControl, style: .continuous)
                .fill(Palette.surfaceSunken)
        )
        .overlay(
            RoundedRectangle(cornerRadius: Metrics.radiusControl, style: .continuous)
                .strokeBorder(Palette.controlBorder, lineWidth: Metrics.hairline)
        )
        .overlay(focusRing)
        .contentShape(Rectangle())
        .onTapGesture { isFocused = true }
    }

    @ViewBuilder
    private var commitButton: some View {
        if isBusy {
            ProgressView()
                .tint(Palette.interaction)
        } else {
            Button(action: commit) {
                Image(systemName: commitSymbol)
                    .imageScale(.medium)
                    .foregroundStyle(isEmpty ? Palette.textMuted : Palette.interaction)
            }
            .buttonStyle(.plain)
            .disabled(isEmpty)
            // Icon-only, so the name has to be declared: the glyph itself is
            // hidden from assistive technology.
            .accessibilityLabel(commitLabel)
        }
    }

    /// Drawn outside the border rather than replacing it, so focus is additive
    /// — a focused control still looks like a control.
    @ViewBuilder
    private var focusRing: some View {
        if isFocused {
            RoundedRectangle(cornerRadius: Metrics.radiusControl, style: .continuous)
                .strokeBorder(Palette.focus, lineWidth: Metrics.focusRingWidth)
                .padding(-Metrics.focusRingOffset)
        }
    }
}
