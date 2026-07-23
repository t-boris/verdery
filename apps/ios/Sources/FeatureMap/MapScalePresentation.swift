import CoreDomain
import CoreLocalization

/// Renders `GardenGeoreference`'s scale/accuracy state as user-facing text.
///
/// `GardenGeoreference.accuracyMetres`/`scaleCorrection` previously drove
/// only `MapBackgroundView`'s positioning math and were never shown to the
/// user as text — this is that missing presentation. A garden without a
/// georeference is a normal, expected state — a garden may begin without any
/// real-world scale at all — so the "not set" text is informational, not an
/// error. `accuracyMetres` stays optional even once a georeference exists,
/// so that clause is included only when present.
public enum MapScalePresentation {
    public static func text(for georeference: GardenGeoreference?, strings: LocalizedStrings) -> String {
        guard let georeference else {
            return strings(.mapScaleNotSet)
        }

        guard let accuracyMetres = georeference.accuracyMetres else {
            return strings(.mapScaleGeoreferenced)
        }

        return strings.string(
            .mapScaleGeoreferencedWithAccuracy,
            parameters: ["accuracyMetres": formatted(accuracyMetres)]
        )
    }

    private static func formatted(_ value: Double) -> String {
        String(format: "%.1f", value)
    }
}
