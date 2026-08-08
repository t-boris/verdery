import CoreDesignSystem
import SwiftUI

/// The view-rotation controls: a compass that turns with the view and taps to
/// north, and — behind it — the 15° steps and the exact angle the architecture
/// document asks for.
///
/// A compass, not a pair of arrows, because the question is spatial: "which way
/// is north" is pointed at, not read. It is also the control this screen
/// appeared to have already — MapKit drew one over the backdrop whenever the
/// map was rotated, and it did nothing, because the backdrop hands every
/// gesture to the `Canvas` above it. That one is now switched off
/// (`MapBackgroundView`), and this is the real thing.
///
/// Hidden entirely without a georeference: with no accepted relationship to
/// north, a needle would be pointing at nothing, and "North up" would have no
/// meaning to restore.
struct MapRotationControl: View {
    @Bindable var model: MapEditorViewModel

    @State private var isAngleFieldPresented = false

    var body: some View {
        if let isNorthUp = model.isNorthUp {
            VStack(spacing: Metrics.space1) {
                needle(isNorthUp: isNorthUp)
                steps
            }
            .padding(Metrics.space2)
            // The console surface, not a thin material. A translucent panel
            // over aerial imagery is a panel over tree canopy, roof, tarmac
            // and lawn at once, and a muted foreground on it disappears —
            // which is exactly what the first version did on the owner's own
            // garden. The chassis colour is the one surface in this palette
            // measured for light-on-dark.
            .background(Palette.console, in: RoundedRectangle(cornerRadius: Metrics.radiusControl))
            .overlay(
                RoundedRectangle(cornerRadius: Metrics.radiusControl)
                    .strokeBorder(Palette.consoleBorder, lineWidth: Metrics.hairline)
            )
            .popover(isPresented: $isAngleFieldPresented) { anglePopover }
        }
    }

    /// Taps to north, and says so — the same control reports the state and
    /// restores it, which is what makes a compass a compass rather than a
    /// readout beside a button.
    private func needle(isNorthUp: Bool) -> some View {
        Button {
            model.alignNorthUp()
        } label: {
            Image(systemName: "location.north.fill")
                .imageScale(.medium)
                // Always the interaction colour; "already north-up" is said
                // by dimming it, not by turning it into another grey on a
                // busy photograph.
                .foregroundStyle(Palette.interaction)
                .opacity(isNorthUp ? 0.35 : 1)
                // North's own screen angle — the garden's rotation plus the
                // view's, not the view's alone. See `northIndicatorDegrees`.
                .rotationEffect(.degrees(model.northIndicatorDegrees))
                .frame(width: Metrics.space5, height: Metrics.space5)
                .accessibilityHidden(true)
        }
        .buttonStyle(.plain)
        .disabled(isNorthUp)
        .accessibilityLabel(model.northUpTitle)
        .accessibilityValue(model.rotationValueDescription)
        .accessibilityIdentifier("map.editor.rotation.northUp")
    }

    private var steps: some View {
        HStack(spacing: Metrics.space1) {
            step(symbol: "rotate.left", clockwise: false, identifier: "counterclockwise")
            Button {
                isAngleFieldPresented = true
            } label: {
                Text(model.rotationShortDescription)
                    .font(FieldConsoleType.label.font)
                    .monospacedDigit()
                    .foregroundStyle(Palette.consoleText)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(model.rotationExactTitle)
            .accessibilityIdentifier("map.editor.rotation.exact")
            step(symbol: "rotate.right", clockwise: true, identifier: "clockwise")
        }
    }

    private func step(symbol: String, clockwise: Bool, identifier: String) -> some View {
        Button {
            model.nudgeRotation(clockwise: clockwise)
        } label: {
            Image(systemName: symbol).imageScale(.small)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(model.rotationStepTitle(clockwise: clockwise))
        .accessibilityIdentifier("map.editor.rotation.\(identifier)")
    }

    /// The exact angle, as a DIAL rather than a typed number.
    ///
    /// The same judgement the georeference screen already makes about north:
    /// "the question is spatial — 'north is that way', pointed at, not 'north
    /// is 37 degrees', computed. Turning past north wraps, which is what a dial
    /// does" (architecture/map-rendering-and-editing.md, section 14.x). A text
    /// field was written here first and was wrong twice over — it also broke
    /// the two conventions this design system enforces in its own tests, that
    /// text entry goes through the four input primitives and that no frame
    /// escapes Dynamic Type.
    private var anglePopover: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            ValueDial(
                fieldName: model.rotationExactTitle,
                valueText: model.rotationShortDescription,
                value: Binding(
                    get: { model.rotationDegrees },
                    set: { model.setRotation(degrees: $0) }
                ),
                range: 0...360,
                step: 1
            )
            .accessibilityIdentifier("map.editor.rotation.exact.dial")

            Button(model.rotationApplyTitle) { isAngleFieldPresented = false }
                .buttonStyle(PrimaryButtonStyle())
                .accessibilityIdentifier("map.editor.rotation.exact.apply")
        }
        .padding(Metrics.space3)
        .presentationCompactAdaptation(.popover)
    }
}
