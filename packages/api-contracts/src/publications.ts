/**
 * The client-publication domain's contract surface (P9C-PUBLISH-01): the
 * separate publisher capability, work-log/media item staging, and the
 * `internal_draft -> ready_for_client -> published -> withdrawn`
 * `client_update` workflow — split out of `index.ts` for the same 600-line
 * source-file rule `organizations.ts` documents for itself; `index.ts`
 * re-exports everything here unchanged.
 */

import type { components } from './generated/schema.js';

type Schemas = components['schemas'];

/** The publisher-capability and client-update-workflow schemas (P9C-PUBLISH-01). */
export type PublisherGrantState = Schemas['PublisherGrantState'];
export type PublisherGrant = Schemas['PublisherGrant'];
export type PublisherGrantListResult = Schemas['PublisherGrantListResult'];
export type GrantPublisherAccessRequest = Schemas['GrantPublisherAccessRequest'];
export type ClientUpdateState = Schemas['ClientUpdateState'];
export type ClientUpdateItemKind = Schemas['ClientUpdateItemKind'];
export type PublicationMediaRole = Schemas['PublicationMediaRole'];
export type ClientUpdateItem = Schemas['ClientUpdateItem'];
export type ClientUpdate = Schemas['ClientUpdate'];
export type ClientUpdateListResult = Schemas['ClientUpdateListResult'];
export type CreateClientUpdateRequest = Schemas['CreateClientUpdateRequest'];
export type UpdateClientUpdateContentRequest = Schemas['UpdateClientUpdateContentRequest'];
export type AddClientUpdateItemRequest = Schemas['AddClientUpdateItemRequest'];
export type WithdrawClientUpdateRequest = Schemas['WithdrawClientUpdateRequest'];
export type WorkLog = Schemas['WorkLog'];
export type WorkLogListResult = Schemas['WorkLogListResult'];
export type PublicationItemKind = Schemas['PublicationItemKind'];
export type PublicationItem = Schemas['PublicationItem'];
export type PublicationStaffAttribution = Schemas['PublicationStaffAttribution'];
export type PublicationVersion = Schemas['PublicationVersion'];
export type PublishGardenSnapshotInput = Schemas['PublishGardenSnapshotInput'];
export type PublishTimelineEntryInput = Schemas['PublishTimelineEntryInput'];
export type PublishStaffAttributionInput = Schemas['PublishStaffAttributionInput'];
export type PublishClientUpdateRequest = Schemas['PublishClientUpdateRequest'];

/**
 * Error codes the publisher-grant endpoints raise (P9C-PUBLISH-01).
 *
 * Non-visibility of an engagement is concealed as `notFound` — the same
 * posture every other module-specific not-found code in this catalogue
 * already documents. `notFound` is also returned for a profile with no
 * grant at all under `revokePublisherAccess` (there is nothing to reveal).
 */
export const PublisherGrantErrorCode = {
  /** No engagement exists at this id, or no grant exists for the named profile on it. */
  NotFound: 'publisher_grant.not_found',
  /** The named profile already holds an ACTIVE grant on this engagement (`publisher_grant_active_key`). */
  AlreadyActive: 'publisher_grant.already_active',
  /** `grantPublisherAccess` named a profile who is not an ACTIVE member of the organization-backed engagement's own organization. */
  GranteeNotOrganizationMember: 'publisher_grant.grantee_not_organization_member',
  /** `grantPublisherAccess` named a profile with no ACTIVE membership on the (no-organization) engagement's own garden. */
  GranteeNotGardenMember: 'publisher_grant.grantee_not_garden_member',
} as const;

export type PublisherGrantErrorCode =
  (typeof PublisherGrantErrorCode)[keyof typeof PublisherGrantErrorCode];

/**
 * Error codes the client-update lifecycle endpoints raise (P9C-PUBLISH-01).
 *
 * `PublisherAccessRequired` is distinct from ordinary `forbidden`-by-role
 * denials elsewhere: it fires even for an actor who otherwise administers
 * the engagement (`manageEngagement`/`manageGarden`), because ADR-0012 makes
 * publisher access a SEPARATE capability those roles do not imply.
 */
export const ClientUpdateErrorCode = {
  /** No client update exists at this id on this engagement. */
  NotFound: 'client_update.not_found',
  /** The caller has no ACTIVE `publisher_grant` on this engagement. */
  PublisherAccessRequired: 'client_update.publisher_access_required',
  /** `createClientUpdate` was attempted against an engagement that is not `active`. */
  EngagementNotActive: 'client_update.engagement_not_active',
  /** A transition, content edit, or item mutation was attempted from a state that does not allow it (`publication-state.ts`). */
  InvalidTransition: 'client_update.invalid_transition',
  /** `submitClientUpdate` was attempted with no `summary` set (`client_update_summary_required_check`). */
  SummaryRequired: 'client_update.summary_required',
  /** No staged item exists at this id on this client update. */
  ItemNotFound: 'client_update.item_not_found',
  /** A staged or inline-published item failed re-validation: it does not exist, or does not belong to the engagement's own garden, or (media) is not `available`. */
  SelectedItemInvalid: 'client_update.selected_item_invalid',
  /** A `publishClientUpdate` staff attribution named a profile id that does not exist. */
  StaffProfileNotFound: 'client_update.staff_profile_not_found',
  /** The supplied `expectedRevision` no longer matches the update's stored revision — distinct from the generic `SharedErrorCode.StaleRevision`, mirroring `GardenErrorCode.StaleRevision`/`MediaErrorCode.StaleRevision`'s own module-specific posture. */
  StaleRevision: 'client_update.stale_revision',
} as const;

export type ClientUpdateErrorCode =
  (typeof ClientUpdateErrorCode)[keyof typeof ClientUpdateErrorCode];
