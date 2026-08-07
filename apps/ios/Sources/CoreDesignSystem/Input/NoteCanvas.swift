import SwiftUI

/// Somewhere to write a few sentences.
///
/// Borderless on purpose. A note is *content*, not a control: the paper it
/// sits on is the whole affordance, and WCAG's non-text contrast rule — which
/// is why ``ComposerField`` insists on its hairline — asks for a boundary only
/// on things a reader has to identify as a control. A box drawn around prose
/// makes a screen look like a form for no gain.
///
/// `TextField(axis: .vertical)` rather than `TextEditor`: the editor cannot
/// carry a placeholder, and fights its own text insets, so every use of it in
/// this codebase had grown a private workaround.
public struct NoteCanvas: View {
    private let accessibilityName: String
    private let placeholder: String
    @Binding private var text: String
    private let characterLimit: Int?

    @FocusState private var isFocused: Bool

    public init(
        accessibilityName: String,
        placeholder: String,
        text: Binding<String>,
        characterLimit: Int? = nil
    ) {
        self.accessibilityName = accessibilityName
        self.placeholder = placeholder
        _text = text
        self.characterLimit = characterLimit
    }

    public var body: some View {
        VStack(alignment: .trailing, spacing: Metrics.space1) {
            TextField(placeholder, text: $text, axis: .vertical)
                .textFieldStyle(.plain)
                .lineLimit(3...14)
                .font(FieldConsoleType.body.font)
                .foregroundStyle(Palette.text)
                .focused($isFocused)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityLabel(accessibilityName)

            if let characterLimit {
                Text("\(text.count)/\(characterLimit)")
                    .font(FieldConsoleType.mono.font)
                    .foregroundStyle(isOverLimit(characterLimit) ? Palette.negative : Palette.textMuted)
                    // The count is a running total, not something to read: a
                    // reader hears the field's own name and its contents.
                    .accessibilityHidden(true)
            }
        }
        .padding(Metrics.space3)
        .background(
            RoundedRectangle(cornerRadius: Metrics.radiusCard, style: .continuous)
                .fill(Palette.surfaceRaised)
        )
        .overlay(focusRing)
        .contentShape(Rectangle())
        .onTapGesture { isFocused = true }
    }

    private func isOverLimit(_ limit: Int) -> Bool { text.count > limit }

    @ViewBuilder
    private var focusRing: some View {
        if isFocused {
            RoundedRectangle(cornerRadius: Metrics.radiusCard, style: .continuous)
                .strokeBorder(Palette.focus, lineWidth: Metrics.focusRingWidth)
                .padding(-Metrics.focusRingOffset)
        }
    }
}
