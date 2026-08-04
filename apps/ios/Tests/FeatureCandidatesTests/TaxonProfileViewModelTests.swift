import CoreDomain
import CoreLocalization
import CoreNetworking
import Foundation
import Testing

@testable import FeatureCandidates

@Suite("Taxon catalog profile")
@MainActor
struct TaxonProfileViewModelTests {
    private func makeModel(
        _ result: Result<TaxonProfile, Error>
    ) -> (TaxonProfileViewModel, FakeCandidatePlantGateway) {
        let gateway = FakeCandidatePlantGateway()
        gateway.taxonProfileResult = result
        let model = TaxonProfileViewModel(
            taxonomyReferenceId: "taxon-1",
            getTaxonProfile: GetTaxonProfile(gateway: gateway),
            strings: LocalizedStrings()
        )
        return (model, gateway)
    }

    private func image(attribution: String?, organ: String? = nil) -> TaxonImage {
        TaxonImage(
            id: "image-1",
            sourceUrl: URL(string: "https://example.org/tomato.jpg")!,
            license: "cc_by",
            attribution: attribution,
            organ: organ
        )
    }

    private func profile(images: [TaxonImage] = [], isPartial: Bool = false) -> TaxonProfile {
        TaxonProfile(
            id: "profile-1",
            taxonomyReferenceId: "taxon-1",
            facts: [
                TaxonProfileFact(
                    factKey: "matureHeightCm",
                    displayValue: "900",
                    unit: "cm",
                    providerKey: "human",
                    sourceCitation: nil
                )
            ],
            isPartial: isPartial,
            assembledAt: Date(timeIntervalSince1970: 0),
            images: images
        )
    }

    @Test("A loaded profile carries its facts and its permitted imagery")
    func loadsProfile() async {
        let (model, _) = makeModel(.success(profile(images: [image(attribution: "A. Botanist")])))

        await model.load()

        #expect(model.state.phase == TaxonProfileViewState.Phase.loaded)
        #expect(model.state.facts.count == 1)
        #expect(model.state.images.count == 1)
    }

    @Test("An image's credit is offered whenever the licence carries one")
    func showsCredit() async {
        let (model, _) = makeModel(.success(profile(images: [image(attribution: "A. Botanist")])))
        await model.load()

        // For CC BY this is the condition the licence was granted under, so
        // the view model must always have it to render.
        #expect(model.imageCredit(model.state.images[0])?.contains("A. Botanist") == true)
    }

    @Test("An image with no attribution condition needs no credit line")
    func noCreditWhenLicenceImposesNone() async {
        let (model, _) = makeModel(.success(profile(images: [image(attribution: nil)])))
        await model.load()

        #expect(model.imageCredit(model.state.images[0]) == nil)
    }

    @Test("Every image is described for a reader who cannot see it")
    func describesImages() async {
        let (model, _) = makeModel(
            .success(profile(images: [image(attribution: nil, organ: "leaf")]))
        )
        await model.load()

        // Never empty: a decorative label would hide the picture from anyone
        // not looking at the screen.
        #expect(!model.imageLabel(model.state.images[0]).isEmpty)
        #expect(model.imageLabel(model.state.images[0]).contains("leaf"))
    }

    @Test("No profile assembled yet reads as missing, not as a failure")
    func missingProfileIsNotAFailure() async {
        // Enrichment simply has not produced one; reporting a fault would say
        // something is broken when nothing is.
        let notFound = APIGatewayError.service(
            APIErrorBody(
                code: "plants.taxon_profile_not_found",
                message: "No profile.",
                correlationId: "correlation-1",
                details: nil,
                retryable: false
            ),
            statusCode: 404,
            retryAfterSeconds: nil
        )
        let (model, _) = makeModel(.failure(notFound))

        await model.load()

        #expect(model.state.phase == TaxonProfileViewState.Phase.missing)
    }

    @Test("A transport failure reads as a failure, with a message")
    func transportFailureIsReported() async {
        let (model, _) = makeModel(
            .failure(APIGatewayError.transport(code: .notConnectedToInternet, correlationId: "c-1"))
        )

        await model.load()

        guard case let .failed(message) = model.state.phase else {
            Issue.record("expected a failure phase")
            return
        }
        #expect(!message.isEmpty)
    }
}
