import CoreDomain
import CoreLocalization
import CoreNetworking
import Foundation
import Observation

/// The taxon catalog profile: reviewed facts about a species and the licensed
/// reference imagery permitted to accompany them (P11-IOS-01).
///
/// Read-only and online-only, like every other catalog read on this client —
/// there is nothing here a person can change, so nothing to queue offline.
///
/// A 404 is `missing`, not `failed`: no profile assembled yet is an ordinary
/// state of a catalog that is still being enriched, and showing it as an
/// error would tell a reader something is broken when nothing is.
@MainActor
@Observable
public final class TaxonProfileViewModel {
    private let getTaxonProfile: GetTaxonProfile
    private let strings: LocalizedStrings
    private let taxonomyReferenceId: String

    public private(set) var state = TaxonProfileViewState()

    public init(
        taxonomyReferenceId: String,
        getTaxonProfile: GetTaxonProfile,
        strings: LocalizedStrings
    ) {
        self.taxonomyReferenceId = taxonomyReferenceId
        self.getTaxonProfile = getTaxonProfile
        self.strings = strings
    }

    public var title: String { strings(TaxonProfileLocalizationKey.taxonProfileTitle) }
    public var loadingLabel: String { strings(TaxonProfileLocalizationKey.taxonProfileLoading) }
    public var missingLabel: String { strings(TaxonProfileLocalizationKey.taxonProfileMissing) }
    public var partialTitle: String { strings(TaxonProfileLocalizationKey.taxonProfilePartialTitle) }
    public var partialLabel: String { strings(TaxonProfileLocalizationKey.taxonProfilePartial) }
    public var noFactsLabel: String { strings(TaxonProfileLocalizationKey.taxonProfileNoFacts) }

    public func factSourceLabel(_ providerKey: String) -> String {
        String(
            format: strings(TaxonProfileLocalizationKey.taxonProfileFactSource),
            providerKey
        )
    }

    /// The image's accessibility label — never empty, because a decorative
    /// label would hide the picture from anyone not looking at it.
    public func imageLabel(_ image: TaxonImage) -> String {
        guard let organ = image.organ else {
            return strings(TaxonProfileLocalizationKey.taxonProfileImageAlt)
        }
        return String(
            format: strings(TaxonProfileLocalizationKey.taxonProfileImageAltOrgan),
            organ
        )
    }

    /// The credit to display, or `nil` when the licence imposes none.
    ///
    /// Never suppressed when present: for CC BY it is the condition the
    /// licence was granted under.
    public func imageCredit(_ image: TaxonImage) -> String? {
        guard let attribution = image.attribution else { return nil }
        return String(
            format: strings(TaxonProfileLocalizationKey.taxonProfileImageCredit),
            attribution
        )
    }

    /// A 404 from this read means enrichment has not produced a profile yet.
    /// Distinguished from every other failure so the screen can say so plainly
    /// instead of reporting a fault.
    private func isProfileMissing(_ failure: APIGatewayError) -> Bool {
        if case let .service(_, statusCode, _) = failure { return statusCode == 404 }
        return false
    }

    private func message(for failure: APIGatewayError) -> String {
        switch failure {
        case .transport:
            strings(.networkUnreachable)
        case .service, .undecodableResponse, .unexpectedStatus:
            strings(.serverUnexpected)
        }
    }

    public func load() async {
        state.phase = .loading
        do {
            let profile = try await getTaxonProfile(taxonomyReferenceId: taxonomyReferenceId)
            state.facts = profile.facts
            state.images = profile.images
            state.isPartial = profile.isPartial
            state.assembledAt = profile.assembledAt
            state.phase = .loaded
        } catch let error as APIGatewayError {
            state.phase = isProfileMissing(error) ? .missing : .failed(message(for: error))
        } catch {
            state.phase = .failed(strings(.serverUnexpected))
        }
    }
}
