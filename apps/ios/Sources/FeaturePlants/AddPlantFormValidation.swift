import CoreDomain

/// Pure validation for the "Add a plant" form, kept free of the view model so
/// it is testable without a gateway or a running view model — the same
/// separation `GeometryValidation` gives `FeatureMap`.
///
/// Source: packages/api-contracts/openapi.yaml, `AddPlantRequest`.
public enum AddPlantFormValidation {
    public enum Failure: Error, Equatable, Sendable {
        case displayNameRequired
        case quantityRequired
        case quantityMustBePositive
    }

    /// Resolves the trimmed display name and the quantity to submit, or the
    /// reason the form cannot be submitted yet.
    ///
    /// `groupingKind == .individual` always resolves `quantity` to `nil`,
    /// regardless of `quantityText` — the contract requires `individual` to
    /// leave `quantity` unset — so a caller need not clear the field itself
    /// when the user switches back to `individual`.
    public static func resolve(
        displayName: String,
        groupingKind: PlantGroupingKind,
        quantityText: String
    ) -> Result<(displayName: String, quantity: Int?), Failure> {
        let trimmedName = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty else { return .failure(.displayNameRequired) }

        guard groupingKind != .individual else {
            return .success((trimmedName, nil))
        }

        let trimmedQuantity = quantityText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedQuantity.isEmpty else { return .failure(.quantityRequired) }
        guard let quantity = Int(trimmedQuantity), quantity > 0 else {
            return .failure(.quantityMustBePositive)
        }

        return .success((trimmedName, quantity))
    }
}
