import Foundation

/// Writes a byte-range slice of an existing local file to a new file —
/// what resuming an interrupted upload needs: a background
/// `URLSessionUploadTask` reads its body from a file path, with no way to
/// tell it "start partway through this other file," so resuming from a
/// nonzero offset means materializing just the remaining bytes as their own
/// file first.
///
/// A free function, not a method on `LocalMediaFileStore`: this is pure
/// byte-range extraction with no notion of "this device's media directory"
/// or profile scoping — `LocalMediaFileStore.temporarySliceURL` supplies the
/// destination path; this only performs the copy.
enum MediaFileSlicing {
    static func writeSlice(of sourceURL: URL, byteRange: Range<Int64>, to destinationURL: URL) throws {
        let handle = try FileHandle(forReadingFrom: sourceURL)
        defer { try? handle.close() }

        try handle.seek(toOffset: UInt64(byteRange.lowerBound))
        let length = Int(byteRange.upperBound - byteRange.lowerBound)
        guard let data = try handle.read(upToCount: length), data.count == length else {
            throw MediaUploadError.localFileMissing
        }
        try data.write(to: destinationURL, options: .atomic)
    }
}
