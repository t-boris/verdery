import CoreDesignSystem
import Testing

/// WCAG contrast, measured against the Field Console token table itself.
///
/// The Swift counterpart of `apps/web/shared/ui/contrast.test.ts`, and the
/// reason `FieldConsole` exists one slice ahead of anything that renders it:
/// the web palette needed two corrections before it passed this same gate
/// (`--color-accent` `#c8431a` → `#b53d18` and `--color-text-muted` `#6a6a5d` →
/// `#66665a`, both recorded in `tokens.css`'s own header), and discovering the
/// equivalent on iOS after forty screens had been restyled would be the
/// expensive order to learn it in.
///
/// This package has no UI test target and CI runs no simulator, so a rendered
/// check is not available — but contrast is a property of the numbers, not of
/// the rendering, so measuring the numbers is the whole of the evidence here.
///
/// Source: architecture/ios-application-design.md, section "19. Testing";
/// technical-specification.md, section 11.
@Suite("Field Console contrast")
struct FieldConsoleContrastTests {
    @Test("clears its threshold in the light appearance", arguments: ContrastPair.all)
    func lightAppearance(pair: ContrastPair) {
        assert(pair, in: .light)
    }

    @Test("clears its threshold in the dark appearance", arguments: ContrastPair.all)
    func darkAppearance(pair: ContrastPair) {
        assert(pair, in: .dark)
    }

    private func assert(_ pair: ContrastPair, in appearance: ContrastRatio.Appearance) {
        let measured = ContrastRatio.rounded(
            ContrastRatio.ratio(pair.foreground, on: pair.background, in: appearance)
        )
        #expect(
            measured >= pair.threshold,
            """
            \(pair) is \(measured):1 in the \(appearance.rawValue) appearance, \
            below the \(pair.threshold):1 it must clear.
            """
        )
    }
}

/// Properties of the palette's shape, as distinct from any one pairing.
@Suite("Field Console palette definition")
struct FieldConsolePaletteTests {
    /// The separate control-boundary token earns its existence only if the
    /// decorative hairline would in fact fail the control threshold. If
    /// `border` ever rose to 3:1 the two tokens would be interchangeable and
    /// the distinction — which every input and quiet button depends on — would
    /// quietly stop meaning anything.
    @Test("keeps the decorative hairline deliberately below the control threshold")
    func decorativeHairlineIsNotAControlBoundary() {
        for appearance in ContrastRatio.Appearance.allCases {
            let decorative = ContrastRatio.ratio(
                FieldConsole.border, on: FieldConsole.surface, in: appearance
            )
            #expect(
                decorative < ContrastPair.aaNonText,
                """
                border on surface is \(ContrastRatio.rounded(decorative)):1 in the \
                \(appearance.rawValue) appearance. It is meant to be a separator that no \
                control reaches for; at or above \(ContrastPair.aaNonText):1 it is \
                indistinguishable from controlBorder and the separation is lost.
                """
            )
            #expect(
                appearance.value(of: FieldConsole.border)
                    != appearance.value(of: FieldConsole.controlBorder)
            )
        }
    }

    /// Field Console's central rule: orange is what you can act on, green is
    /// what is well. The previous palette had `accent` and `positive` set to
    /// the same literal, which meant the interaction signal did not exist as a
    /// distinguishable thing at all.
    @Test("keeps the interaction signal distinct from the positive tone")
    func interactionIsNotSuccess() {
        for appearance in ContrastRatio.Appearance.allCases {
            #expect(
                appearance.value(of: FieldConsole.accent)
                    != appearance.value(of: FieldConsole.positive),
                "accent and positive are the same value in the \(appearance.rawValue) appearance."
            )
        }
    }

    /// The chassis is charcoal in BOTH appearances — dark mode deepens it
    /// rather than inverting it. If a light value ever became light, every
    /// console foreground token would be wrong at once and nothing else in
    /// this suite would notice, because those pairs are only ever measured
    /// against each other.
    @Test("keeps the console chassis dark in both appearances")
    func chassisStaysCharcoal() {
        for (name, token) in ContrastPair.consoleSurfaces {
            for appearance in ContrastRatio.Appearance.allCases {
                let luminance = ContrastRatio.relativeLuminance(appearance.value(of: token))
                #expect(
                    luminance < 0.1,
                    """
                    \(name) has relative luminance \(luminance) in the \(appearance.rawValue) \
                    appearance; the chassis is charcoal in both.
                    """
                )
            }
        }
    }
}
