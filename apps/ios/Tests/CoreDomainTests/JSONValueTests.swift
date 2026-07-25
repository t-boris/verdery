import Foundation
import Testing

@testable import CoreDomain

/// Direct coverage for the passthrough JSON value — public API since
/// P7-IOS-01 moved it here from `CoreNetworking` (where it was exercised
/// only indirectly through the sync gateway suites) for the recommendation
/// evidence/basis fields.
@Suite("JSON value")
struct JSONValueTests {
    @Test("Round-trips nested structure through text unchanged")
    func roundTripsNestedStructure() throws {
        let text = #"{"flags":["stale",true],"count":3,"missing":null,"nested":{"ratio":0.5}}"#

        let value = try JSONValue(jsonText: text)

        #expect(value.value(forKey: "count") == .number(3))
        #expect(value.value(forKey: "missing") == .null)
        #expect(value.value(forKey: "flags") == .array([.string("stale"), .bool(true)]))
        #expect(value.value(forKey: "nested")?.value(forKey: "ratio") == .number(0.5))

        let reparsed = try JSONValue(jsonText: value.jsonText())
        #expect(reparsed == value)
    }

    @Test("stringValue(forKey:) reads only a string member of an object")
    func stringValueReadsStringMembers() throws {
        let value = try JSONValue(jsonText: #"{"recordType":"task","revision":3}"#)

        #expect(value.stringValue(forKey: "recordType") == "task")
        #expect(value.stringValue(forKey: "revision") == nil)
        #expect(value.stringValue(forKey: "absent") == nil)
        #expect(JSONValue.string("not-an-object").stringValue(forKey: "recordType") == nil)
    }

    @Test("Decodes a JSON null as the explicit null case")
    func decodesNull() throws {
        let value = try JSONDecoder().decode(JSONValue.self, from: Data("null".utf8))

        #expect(value == .null)
    }
}
