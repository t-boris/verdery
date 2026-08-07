import Foundation

/// One piece of media an outbox operation refers to, and whether the operation
/// may be accepted before that media finishes uploading.
///
/// The distinction is what makes offline photography possible at all.
/// `architecture/offline-synchronization.md` section 18 draws it: some
/// commands genuinely cannot be applied until their source media exists on the
/// server, and must stay `blockedByDependency`; others reference media as an
/// attachment and may be accepted with it still pending.
///
/// A new observation is the second kind. Somebody standing in a garden with no
/// signal photographs a leaf and writes down what they saw; the record is the
/// note, the measurements and the symptoms, and the photograph joins it when
/// the phone next finds a network. Refusing the whole observation until the
/// upload completes — which is what this client does today — throws away the
/// testimony because the illustration is late.
public struct MediaPrerequisite: Sendable, Equatable, Codable {
    public let mediaId: String

    /// `true` lets the server accept the operation and attach the media
    /// afterwards; `false` keeps it `blockedByDependency` until the upload is
    /// verified.
    ///
    /// Defaults to `false`, which is both the contract's default and the safe
    /// direction: a command that silently applies without media it actually
    /// required would produce a record that is wrong rather than late.
    public let allowsPendingUpload: Bool

    public init(mediaId: String, allowsPendingUpload: Bool = false) {
        self.mediaId = mediaId
        self.allowsPendingUpload = allowsPendingUpload
    }
}
