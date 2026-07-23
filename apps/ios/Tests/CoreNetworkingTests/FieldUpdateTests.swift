import Foundation
import Testing

@testable import CoreNetworking

@Suite("FieldUpdate")
struct FieldUpdateTests {
    private struct Body: Encodable {
        let value: FieldUpdate<String>

        enum CodingKeys: String, CodingKey { case value }

        func encode(to encoder: any Encoder) throws {
            var container = encoder.container(keyedBy: CodingKeys.self)
            try container.encode(value, forKey: .value)
        }
    }

    private func encodedJSONObject(_ body: Body) throws -> [String: Any] {
        let data = try JSONEncoder().encode(body)
        return try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    @Test(".unchanged omits the key entirely")
    func unchangedOmitsKey() throws {
        let object = try encodedJSONObject(Body(value: .unchanged))

        #expect(object["value"] == nil)
        #expect(object.keys.isEmpty)
    }

    @Test(".set(nil) encodes an explicit null")
    func setNilEncodesNull() throws {
        let data = try JSONEncoder().encode(Body(value: .set(nil)))
        let text = try #require(String(data: data, encoding: .utf8))

        #expect(text.contains("\"value\":null"))
    }

    @Test(".set(value) encodes the value")
    func setValueEncodesValue() throws {
        let object = try encodedJSONObject(Body(value: .set("hello")))

        #expect(object["value"] as? String == "hello")
    }

    @Test("Equatable holds for matching cases")
    func equatableHolds() {
        #expect(FieldUpdate<String>.unchanged == FieldUpdate<String>.unchanged)
        #expect(FieldUpdate<String>.set("a") == FieldUpdate<String>.set("a"))
        #expect(FieldUpdate<String>.set(nil) == FieldUpdate<String>.set(nil))
        #expect(FieldUpdate<String>.set("a") != FieldUpdate<String>.set("b"))
        #expect(FieldUpdate<String>.unchanged != FieldUpdate<String>.set(nil))
    }
}
