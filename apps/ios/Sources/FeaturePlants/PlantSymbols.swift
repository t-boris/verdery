import CoreDesignSystem
import CoreDomain

/// Which SF Symbol and tone stand for each plant state.
///
/// The lifecycle table is the most useful of these: a plant's stage is the
/// single fact a gardener scans for, and eight stages read far faster as eight
/// distinct silhouettes than as eight similar words.
enum PlantSymbols {
    static func lifecycleStage(_ stage: PlantLifecycleStage) -> String {
        switch stage {
        case .planned: "calendar.badge.plus"
        case .seed: "circle.dotted"
        case .seedling: "leaf"
        case .transplanted: "arrow.down.to.line"
        case .growing: "leaf.fill"
        case .flowering: "camera.macro"
        case .fruiting: "apple.logo"
        case .readyToHarvest: "basket.fill"
        }
    }

    static func lifecycleTone(_ stage: PlantLifecycleStage) -> Tone {
        switch stage {
        case .planned, .seed: .neutral
        case .seedling, .transplanted, .growing: .accent
        case .flowering, .fruiting: .info
        case .readyToHarvest: .positive
        }
    }

    static func status(_ status: PlantStatus) -> String {
        switch status {
        case .active: "checkmark.circle.fill"
        case .dormant: "moon.zzz.fill"
        case .archived: "archivebox.fill"
        case .removed: "minus.circle.fill"
        case .dead: "xmark.circle.fill"
        }
    }

    static func statusTone(_ status: PlantStatus) -> Tone {
        switch status {
        case .active: .positive
        case .dormant: .info
        case .archived, .removed: .neutral
        case .dead: .negative
        }
    }

    static func groupingKind(_ kind: PlantGroupingKind) -> String {
        switch kind {
        case .individual: "leaf.fill"
        case .row: "line.3.horizontal"
        case .group: "square.grid.2x2.fill"
        }
    }

    static func acquisitionDateType(_ type: PlantAcquisitionDateType) -> String {
        switch type {
        case .planted: "arrow.down.to.line"
        case .sown: "circle.dotted"
        case .acquired: "shippingbox.fill"
        }
    }

    static let quantity = "number"
    static let variety = "tag.fill"
    static let taxonomy = "text.book.closed.fill"
    static let placement = "mappin.and.ellipse"
    static let photo = "photo"
    static let pendingSync = "arrow.triangle.2.circlepath"
    static let condition = "waveform.path.ecg"
    static let careGuidance = "lightbulb.fill"
    static let acquisitionDateGuess = "calendar"
}
