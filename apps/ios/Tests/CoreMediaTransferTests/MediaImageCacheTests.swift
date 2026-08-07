import Foundation
import Testing

@testable import CoreMediaTransfer

/// The cache that makes a signed URL's expiry stop costing a download.
@Suite("Media image cache")
struct MediaImageCacheTests {
    private func bytes(_ count: Int) -> Data {
        Data(repeating: 0xAB, count: count)
    }

    /// The reason this is keyed by media id at all: the same photograph
    /// arrives behind a different signed URL every fifteen minutes, and a
    /// URL-keyed cache would treat each one as a new resource.
    @Test("serves the same photograph after its link has been reissued")
    func hitsAcrossUrlReissue() async {
        let cache = MediaImageCache()
        await cache.store(bytes(1024), forMediaId: "media-1")
        #expect(await cache.data(forMediaId: "media-1") == bytes(1024))
    }

    @Test("misses cleanly for something it has never seen")
    func missesUnknown() async {
        let cache = MediaImageCache()
        #expect(await cache.data(forMediaId: "media-unknown") == nil)
    }

    /// Bounded by bytes, not by count: a thumbnail and a journal frame differ
    /// by two orders of magnitude, and a count limit would hold either six of
    /// one or thousands of the other.
    @Test("evicts the least recently used until it is back inside its budget")
    func evictsLeastRecentlyUsed() async {
        let cache = MediaImageCache(byteLimit: 3_000)
        await cache.store(bytes(1_000), forMediaId: "a")
        await cache.store(bytes(1_000), forMediaId: "b")
        await cache.store(bytes(1_000), forMediaId: "c")

        // Touching "a" makes "b" the oldest.
        _ = await cache.data(forMediaId: "a")
        await cache.store(bytes(1_000), forMediaId: "d")

        #expect(await cache.data(forMediaId: "b") == nil)
        #expect(await cache.data(forMediaId: "a") != nil)
        #expect(await cache.data(forMediaId: "d") != nil)
        #expect(await cache.byteCount <= 3_000)
    }

    /// An image bigger than the whole budget would evict everything and still
    /// not fit, so it is simply not held.
    @Test("declines something larger than its entire budget")
    func declinesOversized() async {
        let cache = MediaImageCache(byteLimit: 1_000)
        await cache.store(bytes(2_000), forMediaId: "huge")
        #expect(await cache.data(forMediaId: "huge") == nil)
        #expect(await cache.byteCount == 0)
    }

    @Test("does not double-count a photograph stored twice")
    func replacesRatherThanAccumulates() async {
        let cache = MediaImageCache()
        await cache.store(bytes(500), forMediaId: "a")
        await cache.store(bytes(700), forMediaId: "a")
        #expect(await cache.byteCount == 700)
    }

    /// Deleting a photograph has to reach the cache, or the bytes outlive the
    /// decision to remove them.
    @Test("forgets a deleted photograph")
    func removesOnDelete() async {
        let cache = MediaImageCache()
        await cache.store(bytes(100), forMediaId: "a")
        await cache.remove(mediaId: "a")
        #expect(await cache.data(forMediaId: "a") == nil)
        #expect(await cache.byteCount == 0)
    }

    /// Cached media belongs to a profile. The next person to use this device
    /// must not be shown the previous one's garden.
    @Test("empties completely on sign-out")
    func clearsEverything() async {
        let cache = MediaImageCache()
        await cache.store(bytes(100), forMediaId: "a")
        await cache.store(bytes(100), forMediaId: "b")
        await cache.removeAll()
        #expect(await cache.byteCount == 0)
        #expect(await cache.data(forMediaId: "a") == nil)
    }
}
