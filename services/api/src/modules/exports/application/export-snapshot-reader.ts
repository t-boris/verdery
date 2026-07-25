/**
 * Port and data model for the export's structured snapshot (P8-EXPORT-01).
 *
 * `readSnapshot` gathers EVERYTHING structured one export packages, inside
 * ONE `REPEATABLE READ, READ ONLY` transaction — that transaction's MVCC
 * snapshot IS the consistency boundary (architecture/data-export-and-
 * deletion.md section 7): rows created after it are absent, and every
 * cross-reference inside the returned data is coherent because every read
 * saw the same snapshot. Queries inside the transaction are bounded pages;
 * what section 6's "do not hold one unbounded database transaction"
 * forbids — holding a transaction open across media byte transfer — never
 * happens here, because bytes are the worker's, after this returns.
 *
 * The shapes below are the PACKAGE's own JSON vocabulary (camelCase,
 * ISO-8601 instants), not persistence rows: what the reader returns is
 * what `export-sections.ts` serializes, so the package format is decided
 * in exactly one place.
 *
 * PRIVACY RULES ENCODED IN THE SHAPE ITSELF:
 * - `ExportMembershipData` carries membership facts only (profile id,
 *   role, state) — never another collaborator's profile row, locale,
 *   time zone, email, preferences, or devices (section 2: "Export does
 *   not expose another collaborator's private account data").
 * - Media metadata covers user-uploaded ORIGINALS (`garden_photo`,
 *   `imported_plan`) in `available` state. `raw_capture` is excluded
 *   (section 4's separate sensitive-media permission has no mechanism
 *   yet), derivatives/processing outputs are rebuildable pipeline
 *   artifacts, and `export_package` rows are other exports.
 * - Notification DEVICE rows (push tokens are secrets) are never read.
 */

import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { ExportScope } from '../domain/export-request.js';

export interface ExportProfileData {
  readonly id: Uuid;
  readonly accountState: string;
  readonly locale: string;
  readonly timeZone: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly providerLinks: readonly {
    readonly provider: string;
    readonly verifiedEmail: string | null;
    readonly linkedAt: string;
  }[];
  readonly consents: readonly {
    readonly consentType: string;
    readonly consentVersion: string;
    readonly grantedAt: string;
  }[];
}

export interface ExportNotificationPreferencesData {
  readonly quietHours: {
    readonly startMinute: number;
    readonly endMinute: number;
    readonly timeZone: string | null;
  } | null;
  readonly entries: readonly {
    readonly notificationType: string;
    readonly gardenId: Uuid | null;
    readonly inAppEnabled: boolean;
    readonly pushEnabled: boolean;
  }[];
}

/** Membership FACTS only — see this file's header. */
export interface ExportMembershipData {
  readonly profileId: Uuid;
  readonly role: string;
  readonly state: string;
  readonly createdAt: string;
}

/** One garden the requester belongs to, as the account manifest discloses it — included gardens carry full content; excluded ones carry the reason. */
export interface ExportGardenListing {
  readonly gardenId: Uuid;
  readonly name: string;
  readonly role: string;
  readonly included: boolean;
  readonly exclusionReason: string | null;
}

export interface ExportMapObjectData {
  readonly id: Uuid;
  readonly coordinateSpaceId: Uuid;
  readonly category: string;
  /** Parsed GeoJSON geometry (garden-local metres — the coordinate space says so). */
  readonly geometry: unknown;
  readonly label: string | null;
  readonly provenance: string;
  readonly confidence: number | null;
  readonly lifecycleState: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** The object's category-detail attributes, merged from its detail table; `null` when the category has none recorded. */
  readonly details: Record<string, unknown> | null;
}

/** One garden's full structured content. Field groups mirror the package's per-garden files. */
export interface ExportGardenData {
  readonly garden: {
    readonly id: Uuid;
    readonly name: string;
    readonly lifecycleState: string;
    readonly revision: number;
    readonly createdAt: string;
    readonly updatedAt: string;
  };
  readonly memberships: readonly ExportMembershipData[];
  readonly coordinateSpaces: readonly Record<string, unknown>[];
  readonly georeferences: readonly Record<string, unknown>[];
  readonly calibrations: readonly Record<string, unknown>[];
  readonly mapObjects: readonly ExportMapObjectData[];
  readonly plants: readonly Record<string, unknown>[];
  readonly plantPhotos: readonly Record<string, unknown>[];
  readonly plantIdentifications: readonly Record<string, unknown>[];
  readonly observations: readonly Record<string, unknown>[];
  readonly observationPhotos: readonly Record<string, unknown>[];
  readonly imageAnalysisResults: readonly Record<string, unknown>[];
  readonly tasks: readonly Record<string, unknown>[];
  readonly taskAttachments: readonly Record<string, unknown>[];
  readonly recommendations: readonly Record<string, unknown>[];
  readonly recommendationEvidence: readonly Record<string, unknown>[];
  readonly recommendationPriorityFactors: readonly Record<string, unknown>[];
  readonly recommendationFeedback: readonly Record<string, unknown>[];
  readonly recommendationAiExplanations: readonly Record<string, unknown>[];
  readonly mediaRecords: readonly Record<string, unknown>[];
}

/** One media file the package will carry — the user-facing half feeds `media-manifest.json`, the storage half feeds the worker-only `media-transfer.json`. */
export interface ExportMediaFileEntry {
  readonly mediaId: Uuid;
  readonly gardenId: Uuid;
  readonly entryPath: string;
  readonly displayFilename: string;
  readonly mediaClass: string;
  readonly contentType: string;
  readonly byteSize: number;
  readonly checksumSha256: string | null;
  readonly bucketName: string;
  readonly objectKey: string;
}

export interface ExportSnapshotData {
  /** The reading transaction's own clock instant — the recorded boundary. */
  readonly boundaryAt: Date;
  readonly scope: ExportScope;
  readonly requesterProfileId: Uuid;
  readonly includeMedia: boolean;
  /** Account scope only; `null` for a garden-scoped export. */
  readonly profile: ExportProfileData | null;
  /** Account scope only; `null` for a garden-scoped export. */
  readonly notificationPreferences: ExportNotificationPreferencesData | null;
  /** Every garden the requester actively belongs to, with inclusion/exclusion disclosed — account scope; for garden scope, the one garden. */
  readonly gardenListings: readonly ExportGardenListing[];
  /** Full content of each INCLUDED garden. */
  readonly gardens: readonly ExportGardenData[];
  /** Entitled media files, when `includeMedia`; always empty otherwise. */
  readonly mediaFiles: readonly ExportMediaFileEntry[];
}

export interface ExportSnapshotScope {
  readonly scope: ExportScope;
  readonly requesterProfileId: Uuid;
  readonly gardenId: Uuid | null;
  readonly includeMedia: boolean;
}

export interface ExportSnapshotReader {
  readSnapshot(input: ExportSnapshotScope): Promise<ExportSnapshotData>;
}
