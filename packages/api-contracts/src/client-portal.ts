/**
 * The client-portal domain's contract surface (P9C-API-01): publication-only
 * read schemas for `ClientGarden`/`ClientGardenOverview`/
 * `ClientPublicationSummary`/`ClientTimelineEntry` and their list results —
 * split out of `index.ts` for the same 600-line source-file rule
 * `organizations.ts`/`publications.ts`/`client-invitations.ts` document for
 * themselves; `index.ts` re-exports everything here unchanged.
 */

import type { components } from './generated/schema.js';

type Schemas = components['schemas'];

/** The client-portal read schemas (P9C-API-01). */
export type ClientGarden = Schemas['ClientGarden'];
export type ClientGardenListResult = Schemas['ClientGardenListResult'];
export type ClientGardenOverview = Schemas['ClientGardenOverview'];
export type ClientPublicationItem = Schemas['ClientPublicationItem'];
export type ClientPublicationStaffAttribution = Schemas['ClientPublicationStaffAttribution'];
export type ClientPublicationSummary = Schemas['ClientPublicationSummary'];
export type ClientPublicationListResult = Schemas['ClientPublicationListResult'];
export type ClientTimelineEntry = Schemas['ClientTimelineEntry'];
export type ClientTimelineResult = Schemas['ClientTimelineResult'];

/** The client export/handoff manifest schemas (P9C-EXPORT-01). */
export type ClientExportGardenModel = Schemas['ClientExportGardenModel'];
export type ClientExportMediaEntry = Schemas['ClientExportMediaEntry'];
export type ClientExportManifest = Schemas['ClientExportManifest'];

/**
 * Error codes the client-portal endpoints raise (P9C-API-01).
 *
 * Deliberately ONE code, reused for every possible cause: a garbage id, an
 * id belonging to another client's engagement, an id whose grant was
 * revoked, and an id whose engagement itself ended or was revoked all
 * produce this SAME code and the same `404` — collaboration-and-client-
 * sharing.md section 13's own sentence, "authorization always starts from
 * the current client profile and active access grant", is exactly the
 * property a second, more specific code would undermine by letting a caller
 * distinguish "wrong" from "nonexistent". `listClientGardens` never raises
 * this: it takes no id at all.
 */
export const ClientPortalErrorCode = {
  /** No client garden (or, for the timeline/publications reads, no visible content on one) exists at this id for the caller. */
  NotFound: 'client_portal.not_found',
} as const;

export type ClientPortalErrorCode =
  (typeof ClientPortalErrorCode)[keyof typeof ClientPortalErrorCode];
