import CoreDomain
import Testing

@testable import FeatureMap

/// Drawing a shape rather than dropping a four-metre square on it.
///
/// The rules asserted here are the ones a person notices immediately if they
/// are wrong: how many points a shape needs before it can be finished, whether
/// a traced edge keeps its corners, and whether a ring closes itself.
@Suite("Map draft session")
struct MapDraftSessionTests {
    private func point(_ x: Double, _ y: Double) -> Position { Position(x: x, y: y) }

    /// Three, not four. Nobody drawing a triangle thinks of it as four points;
    /// the closing vertex is bookkeeping and is added on finish.
    @Test("needs three points for an area and two for a line")
    func minimumPoints() {
        #expect(MapDraftSession(category: .bed).minimumPointCount == 3)
        #expect(MapDraftSession(category: .fence).minimumPointCount == 2)
        #expect(MapDraftSession(category: .tree).minimumPointCount == 1)
    }

    @Test("refuses to finish before it has a shape")
    func cannotFinishEarly() {
        var draft = MapDraftSession(category: .bed)
        draft.addPoint(point(0, 0))
        draft.addPoint(point(4, 0))
        #expect(!draft.canFinish)
        #expect(draft.geometry() == nil)

        draft.addPoint(point(4, 4))
        #expect(draft.canFinish)
    }

    /// The ring closes itself, which is what `GeometryValidation` expects and
    /// what the web's own drafting produces.
    @Test("closes an area's ring on finish")
    func closesRing() {
        var draft = MapDraftSession(category: .bed)
        draft.addPoint(point(0, 0))
        draft.addPoint(point(4, 0))
        draft.addPoint(point(4, 4))

        guard case let .polygon(rings)? = draft.geometry(), let ring = rings.first else {
            Issue.record("expected a polygon")
            return
        }
        #expect(ring.count == 4)
        #expect(ring.first == ring.last)
    }

    @Test("draws a line as a line and a tree as a point")
    func shapesMatchCategories() {
        var line = MapDraftSession(category: .path)
        line.addPoint(point(0, 0))
        line.addPoint(point(3, 0))
        if case .lineString = line.geometry() {} else { Issue.record("expected a line") }

        var single = MapDraftSession(category: .tree)
        single.addPoint(point(1, 1))
        if case .point = single.geometry() {} else { Issue.record("expected a point") }
    }

    /// Tapping again on a point shape is somebody correcting their aim, not
    /// starting a second tree.
    @Test("moves a point rather than collecting more of them")
    func pointMovesOnRetap() {
        var draft = MapDraftSession(category: .plant)
        draft.addPoint(point(1, 1))
        draft.addPoint(point(5, 5))
        #expect(draft.points == [point(5, 5)])
    }

    @Test("takes back the last point")
    func undo() {
        var draft = MapDraftSession(category: .bed)
        draft.addPoint(point(0, 0))
        draft.addPoint(point(1, 0))
        draft.undoLastPoint()
        #expect(draft.points == [point(0, 0)])

        // Undoing an empty draft is a no-op rather than a crash: the button
        // exists before the first point does.
        var empty = MapDraftSession(category: .bed)
        empty.undoLastPoint()
        #expect(empty.points.isEmpty)
    }

    /// A finger produces hundreds of samples for a shape with a handful of
    /// corners, and every one of them would otherwise be persisted,
    /// synchronised, and dragged around by whoever edits the shape next.
    @Test("keeps a traced edge's corners and drops the samples between them")
    func simplifiesTracedPaths() {
        var draft = MapDraftSession(category: .path)
        // A straight run of forty samples with one real corner in it.
        var traced = (0..<20).map { point(Double($0) * 0.5, 0) }
        traced += (0..<20).map { point(10, Double($0) * 0.5) }
        draft.addTracedPath(traced)

        #expect(draft.points.count < traced.count / 4)
        #expect(draft.points.first == point(0, 0))
        #expect(draft.points.last == point(10, 9.5))
        // The corner survives, because it is what the shape is.
        #expect(draft.points.contains { abs($0.x - 10) < 0.01 && abs($0.y) < 0.6 })
    }

    /// Trace a curved edge, then tap the straight corners. Both feed one
    /// draft, because that is how a bed is actually shaped.
    @Test("lets a tap and a trace build one shape together")
    func mixesTapsAndTraces() {
        var draft = MapDraftSession(category: .bed)
        draft.addPoint(point(0, 0))
        draft.addTracedPath([point(1, 0), point(2, 0.4), point(3, 0)])
        draft.addPoint(point(3, 3))
        #expect(draft.points.count >= 4)
        #expect(draft.canFinish)
    }

    /// A slow finger emits samples a fraction of a millimetre apart. Two
    /// vertices that close together are one vertex as far as ADR-0010 is
    /// concerned.
    @Test("coalesces samples closer together than the vertex epsilon")
    func coalescesNearIdenticalSamples() {
        var draft = MapDraftSession(category: .path)
        draft.addPoint(point(0, 0))
        draft.addTracedPath([point(0, 0), point(0.0000001, 0)])
        #expect(draft.points.count == 1)
    }
}
