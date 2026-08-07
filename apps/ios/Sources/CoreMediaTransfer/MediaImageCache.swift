import Foundation

/// Downloaded media bytes, keyed by media id rather than by URL.
///
/// The distinction is the whole point. Media is served through short-lived
/// signed URLs — a fresh one every fifteen minutes — so a `URLCache`, which
/// keys on the request, treats the same photograph as a new resource each time
/// its link is reissued and downloads it again. Six `AsyncImage` call sites
/// have been paying that: a plants list re-fetches every thumbnail whenever a
/// signed URL expires, which on a phone in a garden is bandwidth nobody has.
///
/// A media id, by contrast, names the thing rather than the way to reach it,
/// and media in this product is immutable — a photograph is never edited in
/// place, only superseded — so a hit is always current.
///
/// Bounded by bytes rather than by count: thumbnails and full-frame journal
/// photographs differ by two orders of magnitude, and a count-based limit
/// would either hold six large images or thousands of small ones.
public actor MediaImageCache {
    private struct Entry {
        let data: Data
        var lastUsed: UInt64
    }

    private var entries: [String: Entry] = [:]
    private var totalBytes: Int = 0
    private var clock: UInt64 = 0
    private let byteLimit: Int

    /// 48 MB. Enough for a screen of thumbnails plus a journal sequence being
    /// scrolled, small enough that the system never has a reason to evict this
    /// process for holding it.
    public init(byteLimit: Int = 48 * 1024 * 1024) {
        self.byteLimit = byteLimit
    }

    public func data(forMediaId mediaId: String) -> Data? {
        guard var entry = entries[mediaId] else { return nil }
        clock += 1
        entry.lastUsed = clock
        entries[mediaId] = entry
        return entry.data
    }

    public func store(_ data: Data, forMediaId mediaId: String) {
        // An image larger than the whole budget would evict everything and
        // then not fit, so it is simply not cached.
        guard data.count <= byteLimit else { return }

        if let existing = entries.removeValue(forKey: mediaId) {
            totalBytes -= existing.data.count
        }
        clock += 1
        entries[mediaId] = Entry(data: data, lastUsed: clock)
        totalBytes += data.count
        evictIfNeeded()
    }

    /// Called when a photograph is deleted, so a subsequent id reuse — or a
    /// re-download of something the reader asked to remove — cannot serve the
    /// old bytes.
    public func remove(mediaId: String) {
        guard let entry = entries.removeValue(forKey: mediaId) else { return }
        totalBytes -= entry.data.count
    }

    /// Called on sign-out: cached media belongs to a profile, and the next
    /// person to use this device must not see it.
    public func removeAll() {
        entries.removeAll()
        totalBytes = 0
    }

    public var byteCount: Int { totalBytes }

    private func evictIfNeeded() {
        guard totalBytes > byteLimit else { return }
        // Least recently used first. Sorting on eviction rather than keeping an
        // ordered structure: this runs only when the budget is exceeded, and
        // the map holds hundreds of entries, not millions.
        for (mediaId, _) in entries.sorted(by: { $0.value.lastUsed < $1.value.lastUsed }) {
            guard totalBytes > byteLimit else { break }
            remove(mediaId: mediaId)
        }
    }
}
