import Foundation

/// Generates UUIDv7 identifiers.
///
/// `UUID()` produces UUIDv4. Every identifier this application sends the API
/// — idempotency keys, client-generated record identifiers — must be UUIDv7:
/// the contract's `Uuid` schema pattern requires it, and the backend's own
/// transport validation rejects anything else.
///
/// Source: architecture/data-and-geospatial-design.md, section
/// "4. Identifier Strategy"; packages/api-contracts/openapi.yaml,
/// `components.schemas.Uuid`.
public enum UUIDv7 {
    /// Generates one identifier from the current time.
    public static func generate() -> String {
        generate(at: Date())
    }

    /// Generates one identifier from an explicit time, for deterministic tests.
    public static func generate(at date: Date) -> String {
        var bytes = [UInt8](repeating: 0, count: 16)

        // The first 48 bits are a big-endian Unix millisecond timestamp — what
        // makes a UUIDv7 sort chronologically, an index-locality property this
        // type conveys but does not itself treat as an authoritative
        // creation time.
        let millis = UInt64(date.timeIntervalSince1970 * 1000)
        bytes[0] = UInt8((millis >> 40) & 0xFF)
        bytes[1] = UInt8((millis >> 32) & 0xFF)
        bytes[2] = UInt8((millis >> 24) & 0xFF)
        bytes[3] = UInt8((millis >> 16) & 0xFF)
        bytes[4] = UInt8((millis >> 8) & 0xFF)
        bytes[5] = UInt8(millis & 0xFF)

        var random = [UInt8](repeating: 0, count: 10)
        for index in random.indices {
            random[index] = UInt8.random(in: .min ... .max)
        }
        for index in 0..<10 {
            bytes[6 + index] = random[index]
        }

        // Version nibble: 0111.
        bytes[6] = (bytes[6] & 0x0F) | 0x70
        // Variant: 10xxxxxx (RFC 4122).
        bytes[8] = (bytes[8] & 0x3F) | 0x80

        let hex = bytes.map { String(format: "%02x", $0) }.joined()
        let start = hex.startIndex

        func slice(_ range: Range<Int>) -> String {
            String(hex[hex.index(start, offsetBy: range.lowerBound)..<hex.index(start, offsetBy: range.upperBound)])
        }

        return [slice(0..<8), slice(8..<12), slice(12..<16), slice(16..<20), slice(20..<32)]
            .joined(separator: "-")
    }
}
