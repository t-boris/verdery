import Foundation

/// Initials for a name this application only ever sees as a label.
///
/// The collaboration API exposes no display names — a member arrives as a
/// profile id and a role label — so this makes something recognisable out of
/// whatever text there is. When the contract gains real names, this is the one
/// place that has to change.
enum TaskAssigneeInitials {
    static func from(_ label: String) -> String {
        let words = label.split(whereSeparator: \.isWhitespace).filter {
            $0.contains(where: \.isLetter)
        }
        guard let first = words.first else { return "?" }
        var letters = String(first.prefix(1))
        if words.count > 1, let last = words.last {
            letters += String(last.prefix(1))
        }
        return letters.uppercased()
    }
}
