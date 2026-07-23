import CoreDomain
import Testing

@testable import FeaturePlants

@Suite("Add plant form validation")
struct AddPlantFormValidationTests {
    // `Result<(displayName: String, quantity: Int?), Failure>` cannot itself
    // be `Equatable` — a tuple can never conform to a protocol — so failures
    // are asserted by pattern matching rather than `==`.
    private func failure(
        _ result: Result<(displayName: String, quantity: Int?), AddPlantFormValidation.Failure>
    ) -> AddPlantFormValidation.Failure? {
        if case let .failure(failure) = result { return failure }
        return nil
    }

    @Test("An empty display name is rejected regardless of grouping kind")
    func emptyDisplayNameIsRejected() {
        let result = AddPlantFormValidation.resolve(displayName: "   ", groupingKind: .individual, quantityText: "")

        #expect(failure(result) == .displayNameRequired)
    }

    @Test("An individual plant always resolves quantity to nil, even if quantityText carries a stale value")
    func individualIgnoresQuantityText() {
        let result = AddPlantFormValidation.resolve(displayName: "Tomato", groupingKind: .individual, quantityText: "5")

        switch result {
        case let .success((displayName, quantity)):
            #expect(displayName == "Tomato")
            #expect(quantity == nil)
        case .failure:
            Issue.record("Expected success")
        }
    }

    @Test("A row without a quantity is rejected")
    func rowWithoutQuantityIsRejected() {
        let result = AddPlantFormValidation.resolve(displayName: "Carrots", groupingKind: .row, quantityText: "")

        #expect(failure(result) == .quantityRequired)
    }

    @Test("A non-numeric quantity is rejected")
    func nonNumericQuantityIsRejected() {
        let result = AddPlantFormValidation.resolve(displayName: "Carrots", groupingKind: .row, quantityText: "abc")

        #expect(failure(result) == .quantityMustBePositive)
    }

    @Test("A zero or negative quantity is rejected")
    func nonPositiveQuantityIsRejected() {
        #expect(
            failure(AddPlantFormValidation.resolve(displayName: "Carrots", groupingKind: .group, quantityText: "0"))
                == .quantityMustBePositive
        )
        #expect(
            failure(AddPlantFormValidation.resolve(displayName: "Carrots", groupingKind: .group, quantityText: "-1"))
                == .quantityMustBePositive
        )
    }

    @Test("A positive integer quantity for a group resolves successfully, with the name trimmed")
    func positiveQuantityResolves() {
        let result = AddPlantFormValidation.resolve(displayName: "  Carrots  ", groupingKind: .group, quantityText: "12")

        switch result {
        case let .success((displayName, quantity)):
            #expect(displayName == "Carrots")
            #expect(quantity == 12)
        case .failure:
            Issue.record("Expected success")
        }
    }
}
