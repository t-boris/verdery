/// Keys the taxon catalog profile resolves against the localization catalogue
/// (P11-IOS-01): the reference-image gallery and the fact list beside it.
///
/// A separate enum for the same structural reason every other key set here
/// gives: an enum's cases cannot be declared in an extension, and
/// `LocalizationKey.swift` is already at this repository's 600-line ceiling.
public enum TaxonProfileLocalizationKey: String, Sendable, CaseIterable {
    case taxonProfileTitle = "taxonProfile.title"
    case taxonProfileLoading = "taxonProfile.loading"
    case taxonProfileMissing = "taxonProfile.missing"
    case taxonProfileAssembled = "taxonProfile.assembled"
    case taxonProfilePartialTitle = "taxonProfile.partialTitle"
    case taxonProfilePartial = "taxonProfile.partial"
    case taxonProfileNoFacts = "taxonProfile.noFacts"
    case taxonProfileFactSource = "taxonProfile.factSource"
    case taxonProfileImageAlt = "taxonProfile.imageAlt"
    case taxonProfileImageAltOrgan = "taxonProfile.imageAltOrgan"
    case taxonProfileImageCredit = "taxonProfile.imageCredit"
}
