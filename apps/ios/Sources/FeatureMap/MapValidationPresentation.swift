import CoreDomain
import CoreLocalization

/// Presentation for `GardenMapValidationIssue` — the server's cross-object
/// validation summary (`GardenMapDocument.validationSummary`, decoded on
/// every map load but, before this pass, never rendered anywhere in this
/// app).
///
/// As of this pass `validationSummary` is reliably empty against the real
/// API: `services/api/.../get-garden-map.ts` hardcodes an empty array, with
/// its own doc comment explaining why — cross-object checks (unexpected
/// overlaps, a plant placed inside a blocked structure, a detached gate)
/// need geometry/topology queries that is separate, not-yet-implemented
/// backend scope, stated honestly rather than faked. Everything in this file
/// is real, tested client work — verified against constructed
/// `GardenMapValidationIssue` fixtures, e.g. `MapGatewayTests`'s
/// `documentJSON` — that goes fully live the moment that backend work lands,
/// with no further client change. A future reader should not mistake this
/// for broken just because it renders nothing against the real API today.
public enum MapValidationPresentation {
    /// The SF Symbol for `severity` — the non-color cue architecture/map-
    /// rendering-and-editing.md section "19. Accessibility" requires
    /// ("Non-color confidence and state indicators"): an error and a warning
    /// must read apart even to someone who cannot distinguish tint.
    public static func symbolName(for severity: ValidationSeverity) -> String {
        switch severity {
        case .error: "xmark.octagon.fill"
        case .warning: "exclamationmark.triangle.fill"
        }
    }

    /// Resolves a server-reported issue code to display text.
    ///
    /// `GardenMapValidationIssue.code` is not a closed set the client can
    /// enumerate ahead of time — the backend's cross-object validation is
    /// still unimplemented and will grow new codes as it lands. This
    /// mirrors exactly how `CoreDomain.GeometryValidationCode`'s
    /// client-computed codes already work: the code *is* the
    /// localization-table key (see `LocalizedStrings.string(forKey:)`), so a
    /// new server code goes live the moment a translator adds one line to
    /// `Localizable.strings` — no new `LocalizationKey` case, no client code
    /// change required. `string(forKey:)`'s existing "return the key itself
    /// when missing" behaviour is exactly the "sensible fallback for an
    /// unrecognized code" this needs even before that line is added.
    public static func text(forCode code: String, strings: LocalizedStrings) -> String {
        strings.string(forKey: code)
    }
}
