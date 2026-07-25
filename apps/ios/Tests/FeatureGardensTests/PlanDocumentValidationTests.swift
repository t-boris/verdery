import Testing

@testable import FeatureGardens

/// Local pre-upload plan validation (P6-PLAN iOS parity) — mirrors the
/// web's `GardenPlanUpload` checks and the worker's own `imported_plan`
/// policy: the raster types plus PDF, and the 50 MiB ceiling.
@Suite("Plan document validation")
struct PlanDocumentValidationTests {
    @Test(
        "Accepts every plan type the worker's validation policy accepts",
        arguments: [
            "image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf",
        ]
    )
    func acceptsPolicyTypes(_ contentType: String) {
        #expect(PlanDocumentValidation.validate(contentType: contentType, byteCount: 1024) == nil)
    }

    @Test("Content-type matching is case-insensitive — a picker reporting IMAGE/JPEG still passes")
    func caseInsensitiveTypes() {
        #expect(PlanDocumentValidation.validate(contentType: "IMAGE/JPEG", byteCount: 1) == nil)
    }

    @Test(
        "Rejects types outside the policy",
        arguments: ["image/gif", "image/tiff", "video/mp4", "application/zip", "text/plain", ""]
    )
    func rejectsOtherTypes(_ contentType: String) {
        #expect(
            PlanDocumentValidation.validate(contentType: contentType, byteCount: 1024)
                == .unsupportedType
        )
    }

    @Test("Enforces the 50 MiB ceiling inclusively")
    func enforcesSizeCeiling() {
        let limit = PlanDocumentValidation.maximumByteCount
        #expect(limit == 50 * 1024 * 1024)
        #expect(PlanDocumentValidation.validate(contentType: "image/png", byteCount: limit) == nil)
        #expect(
            PlanDocumentValidation.validate(contentType: "image/png", byteCount: limit + 1) == .tooLarge
        )
    }

    @Test("The limit's user text matches the policy figure")
    func limitText() {
        #expect(PlanDocumentValidation.maximumSizeText == "50 MiB")
    }
}
