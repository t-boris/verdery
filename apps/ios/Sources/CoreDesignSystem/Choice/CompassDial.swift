import SwiftUI

/// Which way north lies, as a dial you turn.
///
/// A dial rather than a number field, because the question is spatial: "north
/// is that way", pointed at, not "north is 37 degrees", computed. The numeral
/// is shown too — in mono, so it is checkable — but it is the readout, not the
/// control.
///
/// Turning past north wraps, because that is what a dial does. The value that
/// leaves is always in `[0, 360)`, which is the range the contract accepts;
/// wrapping happens here, where it is a gesture, and not in the caller, where
/// it would be hiding a miscalculation.
public struct CompassDial: View {
    private let fieldName: String
    private let valueText: String
    @Binding private var degrees: Double
    /// Detents, so a thumb can land on a cardinal direction. Most gardens are
    /// square to something, and the ones that are not still want 5° steps
    /// rather than the 0.3° a fingertip actually produces.
    private let stepDegrees: Double

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledSize(180) private var dialSize
    @ScaledSize(Metrics.space5) private var needleInset

    public init(
        fieldName: String,
        valueText: String,
        degrees: Binding<Double>,
        stepDegrees: Double = 5
    ) {
        self.fieldName = fieldName
        self.valueText = valueText
        _degrees = degrees
        self.stepDegrees = stepDegrees
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: Metrics.space2) {
            HStack {
                Text(fieldName)
                    .textCase(.uppercase)
                    .font(FieldConsoleType.label.font)
                    .foregroundStyle(Palette.textMuted)
                Spacer(minLength: Metrics.space2)
                Text(valueText)
                    .font(FieldConsoleType.monoStrong.font)
                    .foregroundStyle(Palette.text)
            }

            dial
                .frame(width: dialSize, height: dialSize)
                .frame(maxWidth: .infinity)
                // A drag gesture with no accessible equivalent is a control
                // that does not exist for a VoiceOver reader; the adjustable
                // action is what makes the dial reachable at all.
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(fieldName)
                .accessibilityValue(valueText)
                .accessibilityAdjustableAction { direction in
                    switch direction {
                    case .increment: adjust(by: stepDegrees)
                    case .decrement: adjust(by: -stepDegrees)
                    @unknown default: break
                    }
                }
        }
    }

    private var dial: some View {
        GeometryReader { proxy in
            let centre = CGPoint(x: proxy.size.width / 2, y: proxy.size.height / 2)
            ZStack {
                Circle()
                    .fill(Palette.surfaceSunken)
                Circle()
                    .strokeBorder(Palette.border, lineWidth: Metrics.hairline)

                // The garden's own "up", fixed. Without a static reference the
                // needle's angle means nothing — a rotation is between two
                // things, and this is the other one.
                Rectangle()
                    .fill(Palette.border)
                    .frame(width: Metrics.hairline)
                    .padding(.vertical, needleInset)

                needle(in: proxy.size)
            }
            .contentShape(Circle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        setFromTouch(value.location, centre: centre)
                    }
            )
        }
    }

    private func needle(in size: CGSize) -> some View {
        // Screen angles run clockwise from "up", which is exactly how the
        // contract defines this rotation — so the needle needs no conversion,
        // and there is no sign error waiting in one.
        Capsule()
            .fill(Palette.interaction)
            .frame(width: Metrics.space2)
            .padding(.vertical, needleInset)
            .overlay(alignment: .top) {
                Image(systemName: "location.north.fill")
                    .imageScale(.medium)
                    .foregroundStyle(Palette.interaction)
                    .offset(y: -Metrics.space3)
            }
            .rotationEffect(.degrees(degrees))
            .animation(Motion.quick(reduceMotion), value: degrees)
            .frame(width: size.width, height: size.height)
    }

    private func setFromTouch(_ location: CGPoint, centre: CGPoint) {
        let dx = location.x - centre.x
        let dy = location.y - centre.y
        // A touch at the exact centre has no direction; ignoring it keeps the
        // needle where it was rather than snapping it to an arbitrary angle.
        guard abs(dx) > 0.5 || abs(dy) > 0.5 else { return }

        // `atan2(dx, -dy)` measures clockwise from "up", which is the
        // convention this value is stored in.
        let radians = atan2(dx, -dy)
        let raw = radians * 180 / .pi
        let snapped = (raw / stepDegrees).rounded() * stepDegrees
        let normalized = snapped.truncatingRemainder(dividingBy: 360)
        degrees = normalized < 0 ? normalized + 360 : normalized
    }

    private func adjust(by delta: Double) {
        let next = (degrees + delta).truncatingRemainder(dividingBy: 360)
        degrees = next < 0 ? next + 360 : next
    }
}
