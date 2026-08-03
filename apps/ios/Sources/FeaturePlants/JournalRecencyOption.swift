/// The single journal-recency control, over the API's two independent bounds.
///
/// `searchPlants` takes `observedWithinDays` and `notObservedForDays`
/// separately, and they are not complements: a plant with NO observation
/// matches the second and cannot match the first. Offering both as fields
/// would invite a combination that returns nothing and reads as a bug, so the
/// UI offers one choice and this type maps it to at most one bound.
///
/// `neverSeen` uses the widest bound the contract allows: a plant with no
/// observation matches every neglect bound, and no narrower value can single
/// it out.
///
/// Source: packages/api-contracts/openapi.yaml, operation `searchPlants`.
public enum JournalRecencyOption: String, CaseIterable, Sendable {
    case any
    case seen7
    case seen30
    case notSeen30
    case notSeen90
    case neverSeen

    static let neverSeenDays = 3650

    var observedWithinDays: Int? {
        switch self {
        case .seen7: 7
        case .seen30: 30
        default: nil
        }
    }

    var notObservedForDays: Int? {
        switch self {
        case .notSeen30: 30
        case .notSeen90: 90
        case .neverSeen: Self.neverSeenDays
        default: nil
        }
    }
}
