import CoreDomain
import Foundation
import Testing

@testable import FeatureMap

@Suite("Map accessibility labels")
struct MapAccessibilityLabelsTests {
    private func object(label: String?, state: ObjectLifecycleState = .active) -> GardenMapObject {
        GardenMapObject(
            id: "obj-1",
            gardenId: "garden-1",
            category: .tree,
            geometry: .point(Position(x: 0, y: 0)),
            coordinateSpaceId: "space-1",
            label: label,
            categoryDetails: nil,
            lifecycleState: state,
            revision: 1,
            createdAt: Date(timeIntervalSince1970: 0),
            updatedAt: Date(timeIntervalSince1970: 0)
        )
    }

    @Test("An active object with a label reads category and label, no deleted suffix")
    func activeLabeledObject() {
        let row = MapAccessibilityLabels.row(
            for: object(label: "Old Oak"),
            categoryName: "Tree",
            untitledFallback: "Untitled",
            deletedSuffix: "deleted"
        )

        #expect(row.title == "Old Oak")
        #expect(row.accessibilityLabel == "Tree, Old Oak")
        #expect(!row.isDeleted)
    }

    @Test("A nil label falls back to the untitled string, not an empty title")
    func nilLabelFallsBack() {
        let row = MapAccessibilityLabels.row(
            for: object(label: nil),
            categoryName: "Tree",
            untitledFallback: "Untitled",
            deletedSuffix: "deleted"
        )

        #expect(row.title == "Untitled")
        #expect(row.accessibilityLabel == "Tree, Untitled")
    }

    @Test("A whitespace-only label falls back the same way an absent one does")
    func whitespaceOnlyLabelFallsBack() {
        let row = MapAccessibilityLabels.row(
            for: object(label: "   "),
            categoryName: "Tree",
            untitledFallback: "Untitled",
            deletedSuffix: "deleted"
        )

        #expect(row.title == "Untitled")
    }

    @Test("A deleted object's spoken label carries a non-color state indicator")
    func deletedObjectAppendsSuffix() {
        let row = MapAccessibilityLabels.row(
            for: object(label: "Old Oak", state: .deleted),
            categoryName: "Tree",
            untitledFallback: "Untitled",
            deletedSuffix: "deleted"
        )

        #expect(row.accessibilityLabel == "Tree, Old Oak, deleted")
        #expect(row.isDeleted)
    }
}
