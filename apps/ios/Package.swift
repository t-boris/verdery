// swift-tools-version: 6.2

import PackageDescription

// The Apple client lives in the monorepo but deliberately stays outside the
// pnpm workspace, so Swift Package Manager — not an .xcodeproj — is the unit of
// truth for module boundaries. Targets are the mechanism that enforces the
// dependency rule: a Core target cannot name a Feature target, so the compiler
// rejects an inverted import instead of a reviewer having to notice it.
//
// Source: architecture/README.md, section "5. Repository Shape";
// architecture/ios-application-design.md, sections "4. Application Structure"
// and "21. Dependency Rules".
let package = Package(
    name: "Verdery",
    // English is the development language; every other catalogue is a
    // translation of it.
    defaultLocalization: "en",
    // iOS 18.0 is the pinned deployment target. macOS is declared only so the
    // package builds and tests headlessly with `swift build` and `swift test`
    // on a developer machine and in CI; no macOS product is shipped.
    //
    // Source: ADR-0009, "Apple deployment target".
    platforms: [.iOS(.v18), .macOS(.v15)],
    products: [
        .library(name: "CoreDomain", targets: ["CoreDomain"]),
        .library(name: "CoreNetworking", targets: ["CoreNetworking"]),
        .library(name: "CoreObservability", targets: ["CoreObservability"]),
        .library(name: "CoreLocalization", targets: ["CoreLocalization"]),
        .library(name: "FeatureHealth", targets: ["FeatureHealth"]),
        .library(name: "AppComposition", targets: ["AppComposition"]),
    ],
    targets: [
        // Core: platform-neutral meaning. Depends on nothing, so geometry
        // semantics stay testable without a network, a database, or SwiftUI.
        .target(name: "CoreDomain"),

        .target(
            name: "CoreObservability",
            dependencies: ["CoreDomain"]
        ),

        // Localized strings are a Core capability rather than a feature asset
        // because validation issue codes produced by CoreDomain must resolve to
        // the same text on every screen that surfaces them.
        .target(
            name: "CoreLocalization",
            dependencies: ["CoreDomain"],
            resources: [.process("Resources")]
        ),

        .target(
            name: "CoreNetworking",
            dependencies: ["CoreDomain", "CoreObservability"]
        ),

        // Feature template. A feature may depend on Core; Core never names a
        // feature.
        .target(
            name: "FeatureHealth",
            dependencies: ["CoreDomain", "CoreNetworking", "CoreLocalization"]
        ),

        // The single composition root that constructs adapters and injects them
        // through explicit initializers.
        .target(
            name: "AppComposition",
            dependencies: [
                "CoreDomain",
                "CoreNetworking",
                "CoreObservability",
                "CoreLocalization",
                "FeatureHealth",
            ]
        ),

        .executableTarget(
            name: "VerderyApp",
            dependencies: ["AppComposition"]
        ),

        .testTarget(
            name: "CoreDomainTests",
            dependencies: ["CoreDomain"]
        ),
        .testTarget(
            name: "CoreNetworkingTests",
            dependencies: ["CoreNetworking"]
        ),
        .testTarget(
            name: "CoreLocalizationTests",
            dependencies: ["CoreLocalization"]
        ),
        .testTarget(
            name: "FeatureHealthTests",
            dependencies: ["FeatureHealth"]
        ),
        .testTarget(
            name: "ArchitectureTests"
        ),
    ]
)
