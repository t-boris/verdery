/**
 * `GetClientExportManifest` (P9C-EXPORT-01): `GET /client/gardens/
 * {clientGardenId}/exports` — the client-scoped equivalent of P8-EXPORT-01's
 * operational export, scoped to exactly what architecture/collaboration-and-
 * client-sharing.md section 18 allows: "The default residential-service
 * policy makes the accepted garden model and published deliverables
 * client-exportable. It excludes provider-internal notes, assignments,
 * estimates, recommendations, drafts, diagnostics, raw captures, and
 * unpublished work."
 *
 * SYNCHRONOUS, UNLIKE THE OPERATIONAL EXPORT. `RequestExport`/
 * `RunExportSnapshot`/`CompleteExport`'s request-then-poll-then-download
 * shape exists because an OPERATIONAL export can carry an entire garden's
 * history plus every original media file, staged and ZIPped by a Cloud
 * Tasks worker (data-export-and-deletion.md section 6). A client export is
 * categorically smaller: the CURRENT map/plants state (no history, no
 * revisions) plus a bounded set of already-published summaries, and media
 * is served as short-lived signed URLs — the same one-item-at-a-time
 * mechanism `GetClientMediaAccess`/`/client/publications/{id}/media/{id}/
 * access` already uses — never ZIPped bytes. Architecture section 13 lists
 * this route alongside the OTHER synchronous `ClientPortal` reads
 * (`overview`/`publications`/`timeline`), not alongside the `Exports` tag's
 * asynchronous shape, and section 14 calls the whole portal "deliberately
 * read-only" — mirroring the async shape here would add an idempotency
 * store, a durable job row, and a worker round trip that nothing about this
 * bounded read needs. What IS reused from P8-EXPORT-01 is the DISCIPLINE —
 * "the manifest discloses what is included, and an item that fails
 * entitlement is absent, never silently included" — not the ZIP/staging/
 * Cloud-Tasks machinery, because nothing here produces a byte volume that
 * needs it.
 *
 * AUTHORIZATION: `ClientPortalAuthorization.requireExportableGardenAccess` —
 * the SAME class every other client-portal read uses, extended with ONE new
 * method (see that method's own header for the full ended-vs-revoked
 * reasoning) rather than a second authorization class.
 *
 * ACCEPTED GARDEN MODEL: reads through the SAME repositories and view
 * functions the operational `getGardenMap`/`searchPlants` reads already use
 * (`MapObjectRepository.listForGarden` — "every ACTIVE object," excluding
 * soft-deleted history by construction; `CoordinateSpaceRepository`;
 * `GeoreferenceRepository`; `PlantRepository.search`; `toGardenObjectResource`/
 * `toGeoreferenceResource`/`toPlantResource`) — never a second copy of that
 * mapping logic. Only the authorization gate is new, the same "share the
 * mechanism, not the gate" posture `GetClientMediaAccess`'s own header
 * documents for `MediaStorageGateway.createSignedDownloadUrl`. Garden
 * memberships and calibrations are deliberately NOT read here: neither is
 * "the accepted garden model" section 18 names (memberships are operational
 * collaborator identities; calibrations are capture-processing diagnostics,
 * explicitly excluded).
 *
 * PUBLISHED DELIVERABLES: `ClientPublicationReadRepository.
 * listVisibleForEngagement` plus `toClientPublicationSummaryResource` — the
 * EXACT query and shaping `listClientPublications` already uses, so a
 * withdrawn publication is excluded from the export the identical way it is
 * excluded from that live route. DECIDED: "published deliverables" here
 * means CURRENTLY published, not "ever published" — section 10 says
 * withdrawal "removes a publication from ordinary client queries and
 * revokes its media entitlements"; an export that included withdrawn
 * content anyway would be a side channel around the client's own portal,
 * the exact failure mode this package's own instructions warn against.
 *
 * MEDIA ENTITLEMENT: every `media`-kind item across every included
 * publication is re-checked, ONE AT A TIME, through the SAME
 * `GetClientMediaAccess` command the live media-access route calls — never
 * a re-derived rule. An item this client is not entitled to is silently
 * absent from `media`, the same "honest absence, not a distinguishable
 * error" convention `GetClientGardenOverview` already established for a
 * garden with no snapshot yet.
 *
 * GENUINE GAP, FLAGGED NOT INVENTED. Section 18 step 3 promises portal/media
 * access survives "the configured handoff window" after an engagement ends.
 * No such window is configured anywhere in this codebase today —
 * `GetClientMediaAccess` requires the entitling engagement to be `active`,
 * full stop, so media becomes unavailable the INSTANT an engagement ends,
 * not after a grace period. This command does not invent a number to close
 * that gap: it makes the export's own media list behave consistently with
 * the live media-access route (both go to empty at the same instant, for
 * the same reason), and records the gap here rather than silently working
 * around it.
 *
 * DELETION CONSISTENCY. `client_engagement.garden_id` deliberately carries
 * NO foreign key (see the P9B-DATA-01 migration's own "NO FOREIGN KEY ON
 * garden_id" note): a purged garden's row is gone, but the engagement row
 * — and every publication/entitlement row keyed to the ENGAGEMENT, not the
 * garden — survives, for section 18's own "Preserves provider records
 * required for audit, dispute, legal, or retention obligations." That
 * preservation is for the PROVIDER, not for continued client service: once
 * `GardenRepository.findById` returns `null` (or the garden has reached
 * `purging` — the point past which the operational `exportGarden`
 * capability is ALSO refused, for the identical "a request accepted now
 * would point at a row the purge is about to delete" reason), this command
 * refuses the SAME way an unknown `clientGardenId` does: concealed
 * not-found, never a partial or stale garden model. `deletionRequested`
 * stays exportable, mirroring the operational export's own posture exactly
 * — "do not invent a different retention posture for the client-facing
 * copy of the same underlying data."
 *
 * AUDIT, ADDED BY P9C-OBS-01. Section 19 names "export" as its own required
 * audit category, DISTINCT from "portal access to sensitive media" — every
 * media item this manifest includes is already separately audited by
 * `GetClientMediaAccess` itself (this command calls it once per entitled
 * item, so that audit trail is already complete and is not duplicated
 * here). This command additionally records ONE
 * `client_export.manifest_generated` row per call, identifying the
 * ENGAGEMENT/GARDEN and a COUNT of what was included — never the garden
 * model, plant data, or media ids themselves. The METRIC half ("engagement
 * handoff/export completion") is served by the structured log line
 * `client-export-routes.ts` ALREADY emits (`client_export.manifest_served`,
 * landed with P9C-EXPORT-01) — this audit row is the missing DURABLE half,
 * not a duplicate of that signal.
 *
 * Source: architecture/collaboration-and-client-sharing.md, section
 * "18. Data Stewardship, Export, and Engagement End";
 * architecture/data-export-and-deletion.md; implementation-plan.md work
 * packages P9C-EXPORT-01, P9C-OBS-01.
 */

import type { ClientPublicationSummary } from '@verdery/api-contracts';
import { ClientPortalErrorCode, MediaErrorCode } from '@verdery/api-contracts';
import type { AuditLogger } from '../../../platform/audit/audit-logger.js';
import { ApplicationError, NotFoundError } from '../../../platform/errors/application-error.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type {
  ClientPortalAuthorization,
  ClientPublicationReadRepository,
  PublicationVersionDetail,
} from '../../collaboration/public.js';
import { toClientPublicationSummaryResource } from '../../collaboration/public.js';
import type {
  CoordinateSpaceRepository,
  Garden,
  GardenRepository,
  GeoreferenceRepository,
  MapObjectRepository,
} from '../../gardens-mapping/public.js';
import { toGardenObjectResource, toGeoreferenceResource } from '../../gardens-mapping/public.js';
import type { GetClientMediaAccess } from '../../media/public.js';
import type { PlantRepository, PlantSearchFilters } from '../../plants-inventory/public.js';
import { toPlantResource } from '../../plants-inventory/public.js';
import type {
  ClientExportGardenModelResource,
  ClientExportManifestResource,
  ClientExportMediaEntryResource,
} from './client-export-view.js';

/** Every plant, unfiltered — the accepted garden model wants the CURRENT full set, not a search result. `search`'s own cursor pagination is looped to completion. */
const PLANT_SEARCH_FILTERS: PlantSearchFilters = {
  query: null,
  lifecycleStage: null,
  status: null,
  groupingKind: null,
};

/** Comfortably above any real garden's plant count; bounds one page's memory without needing more than a handful of round trips for the gardens this route serves. */
const PLANT_PAGE_SIZE = 500;

/** The same concealed code `ClientPortalAuthorization` itself raises — constructed locally for the one defensive case that class cannot cover (the engagement's own `gardenId` no longer resolving to a live garden row; see this file's own header, "DELETION CONSISTENCY"). */
function clientGardenGoneError(): NotFoundError {
  return new NotFoundError(ClientPortalErrorCode.NotFound, 'No client garden exists at this id.');
}

function isMediaEntitlementDenial(error: unknown): boolean {
  return (
    error instanceof ApplicationError &&
    (error.code === MediaErrorCode.NotFound || error.code === MediaErrorCode.NotAvailable)
  );
}

const MANIFEST_GENERATED_AUDIT_EVENT_TYPE = 'client_export.manifest_generated';

export class GetClientExportManifest {
  constructor(
    private readonly authorization: ClientPortalAuthorization,
    private readonly publications: ClientPublicationReadRepository,
    private readonly gardens: GardenRepository,
    private readonly coordinateSpaces: CoordinateSpaceRepository,
    private readonly georeferences: GeoreferenceRepository,
    private readonly mapObjects: MapObjectRepository,
    private readonly plants: PlantRepository,
    private readonly clientMediaAccess: GetClientMediaAccess,
    private readonly auditLogger: AuditLogger,
    private readonly clock: Clock,
  ) {}

  async execute(
    clientProfileId: Uuid,
    clientGardenId: Uuid,
  ): Promise<ClientExportManifestResource> {
    const engagement = await this.authorization.requireExportableGardenAccess(
      clientProfileId,
      clientGardenId,
    );

    const garden = await this.gardens.findById(engagement.gardenId);
    if (garden === null || garden.lifecycleState === 'purging') {
      // Either the garden row is gone (purged) or the purge is actively
      // removing its content right now — both mean "no readable garden
      // model survives," the identical reason the operational
      // `exportGarden` capability is refused once `purging`. `active`,
      // `archived`, and `deletionRequested` all proceed unchanged, mirroring
      // that same operational posture exactly.
      throw clientGardenGoneError();
    }

    const gardenModel = await this.buildGardenModel(garden);
    const versions = await this.publications.listVisibleForEngagement(clientGardenId);
    const publications: readonly ClientPublicationSummary[] = versions.map(
      toClientPublicationSummaryResource,
    );
    const media = await this.buildEntitledMedia(clientProfileId, versions);

    // P9C-OBS-01: "export" is its own required audit category (section
    // 19), distinct from the per-media-item "portal access to sensitive
    // media" audit `GetClientMediaAccess` already wrote above, once per
    // entitled item. Counts only — never the garden model, plant data, or
    // media ids themselves.
    await this.auditLogger.record({
      eventType: MANIFEST_GENERATED_AUDIT_EVENT_TYPE,
      subjectType: 'client_engagement',
      subjectId: clientGardenId,
      actorProfileId: clientProfileId,
      actorType: 'user',
      gardenId: engagement.gardenId,
      details: { publicationCount: publications.length, mediaCount: media.length },
    });

    return {
      clientGardenId,
      generatedAt: this.clock.now().toISOString(),
      gardenModel,
      publications,
      media,
    };
  }

  private async buildGardenModel(garden: Garden): Promise<ClientExportGardenModelResource> {
    const now = this.clock.now();
    const coordinateSpace = await this.coordinateSpaces.findOrCreateForGarden(garden.id, now);
    const georeference = await this.georeferences.findCurrentForGarden(garden.id);
    const objects = await this.mapObjects.listForGarden(garden.id, null);
    const plants = await this.readAllPlants(garden.id);

    return {
      id: garden.id,
      name: garden.name,
      // Wire-format mapping mirrors `toGardenResource`'s own single
      // exception exactly — the domain's `deletion_requested` becomes the
      // contract's `deletionRequested`; every other value already matches.
      lifecycleState:
        garden.lifecycleState === 'deletion_requested'
          ? 'deletionRequested'
          : garden.lifecycleState,
      revision: garden.revision,
      createdAt: garden.createdAt.toISOString(),
      updatedAt: garden.updatedAt.toISOString(),
      coordinateSpaceId: coordinateSpace.id,
      ...(georeference === null ? {} : { georeference: toGeoreferenceResource(georeference) }),
      mapObjects: objects.map(toGardenObjectResource),
      plants: plants.map((plant) => toPlantResource(plant)),
    };
  }

  private async readAllPlants(gardenId: Uuid) {
    const items = [];
    let cursor: string | null = null;
    for (;;) {
      const page = await this.plants.search(
        gardenId,
        PLANT_SEARCH_FILTERS,
        cursor,
        PLANT_PAGE_SIZE,
      );
      items.push(...page.items);
      if (page.nextCursor === null) {
        break;
      }
      cursor = page.nextCursor;
    }
    return items;
  }

  private async buildEntitledMedia(
    clientProfileId: Uuid,
    versions: readonly PublicationVersionDetail[],
  ): Promise<ClientExportMediaEntryResource[]> {
    const mediaIds = new Set<Uuid>();
    for (const version of versions) {
      for (const item of version.items) {
        if (item.kind === 'media') {
          mediaIds.add(item.mediaRecordId);
        }
      }
    }

    const entries: ClientExportMediaEntryResource[] = [];
    for (const mediaId of mediaIds) {
      const access = await this.tryGetEntitledAccess(clientProfileId, mediaId);
      if (access !== null) {
        entries.push({ mediaId, access });
      }
    }
    return entries;
  }

  private async tryGetEntitledAccess(
    clientProfileId: Uuid,
    mediaId: Uuid,
  ): Promise<ClientExportMediaEntryResource['access'] | null> {
    try {
      return await this.clientMediaAccess.execute(clientProfileId, mediaId);
    } catch (error) {
      if (isMediaEntitlementDenial(error)) {
        // Not entitled (`mediaNotFoundError`) or not currently available
        // (`mediaNotAvailableError`) — both mean "absent from the export,"
        // never a manifest-generation failure. Anything else (a genuine
        // infrastructure fault) is re-thrown so a real failure stays
        // visible rather than silently thinning the manifest.
        return null;
      }
      throw error;
    }
  }
}
