import SwiftUI

/// A person, as a disc of initials.
///
/// Assigning a task used to be an inline `Picker` of role strings — a list of
/// words where the question is "who". A row of faces answers it at a glance,
/// and initials are the closest this application can get to a face: it has no
/// avatar upload, and inventing one would be a feature nobody asked for.
public struct AvatarMedallion: View {
    private let initials: String
    private let caption: String?
    private let isSelected: Bool

    @ScaledSize(Metrics.minimumTouchTarget) private var discSize

    public init(initials: String, caption: String? = nil, isSelected: Bool = false) {
        self.initials = initials
        self.caption = caption
        self.isSelected = isSelected
    }

    public var body: some View {
        VStack(spacing: Metrics.space1) {
            Text(initials)
                .font(FieldConsoleType.monoStrong.font)
                .foregroundStyle(Palette.text)
                .frame(width: discSize, height: discSize)
                .background(Circle().fill(Palette.surfaceSunken))
                .overlay(
                    Circle().strokeBorder(
                        // Selection is a ring, the same mark every other
                        // chooser in this design system uses, so "chosen"
                        // looks the same wherever it appears.
                        isSelected ? Palette.interaction : Palette.border,
                        lineWidth: isSelected ? Metrics.focusRingWidth : Metrics.hairline
                    )
                )

            if let caption {
                Text(caption)
                    .font(FieldConsoleType.detail.font)
                    .foregroundStyle(Palette.textMuted)
                    .lineLimit(1)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(caption ?? initials)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }
}
