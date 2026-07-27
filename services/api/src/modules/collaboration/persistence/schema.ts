import type { Generated } from 'kysely';

/**
 * Kysely row types for the six tables
 * `1786600000000_service-organizations-and-client-engagements.sql` (P9B-DATA-01)
 * adds, plus the ten `1786700000000_client-publication-and-work-logs.sql`
 * (P9C-DATA-01) adds below them. All sixteen live in the `collaboration`
 * Postgres schema, matching `architecture/data-and-geospatial-design.md`
 * section "3. Schema Ownership" ("Collaboration — Memberships,
 * organizations, assignments, engagements, work logs, publications, and
 * grants"). No table declared here overlaps with `gardens-mapping/
 * persistence/schema.ts`'s own `collaboration.*` entries (`membership`,
 * `membership_period`, `invitation`, `ownership_transfer`) — see the P9B
 * migration's own header for why the schema is, for now, typed from two
 * TypeScript modules.
 */

/** Mirrors `collaboration.service_organization`. No lifecycle column — see the migration's own comment for why. */
export interface ServiceOrganizationRow {
  id: string;
  name: string;
  revision: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

/** Mirrors `collaboration.organization_membership` — the current-state row, structurally identical to `gardens-mapping`'s `MembershipRow`. */
export interface OrganizationMembershipRow {
  id: string;
  organization_id: string;
  profile_id: string;
  role: string;
  state: string;
  revision: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

/** Mirrors `collaboration.organization_membership_period` — the append-only interval history, structurally identical to `gardens-mapping`'s `MembershipPeriodRow`. */
export interface OrganizationMembershipPeriodRow {
  id: string;
  membership_id: string;
  organization_id: string;
  profile_id: string;
  role: string;
  valid_from: Date;
  valid_until: Date | null;
  ended_reason: string | null;
  created_at: Generated<Date>;
}

/**
 * Mirrors `collaboration.garden_assignment` — the ONLY mechanism through
 * which organization membership becomes garden access. Built directly in
 * `membership_period`'s append-only shape; see the migration's own "WHY
 * `garden_assignment` GETS NO SEPARATE PERIOD TABLE" comment. `garden_id`
 * carries no foreign key, matching `membership.garden_id`'s own posture
 * since P8-DELETE-01, so an assignment record can survive a garden purge.
 */
export interface GardenAssignmentRow {
  id: string;
  organization_id: string;
  profile_id: string;
  garden_id: string;
  role: string;
  state: Generated<string>;
  valid_from: Generated<Date>;
  valid_until: Date | null;
  created_by_profile_id: string;
  created_at: Generated<Date>;
}

/**
 * Mirrors `collaboration.client_engagement`. `garden_id` carries no foreign
 * key for the same reason `GardenAssignmentRow.garden_id` does not.
 * `stewardship_policy` is `Generated<string>` rather than a literal type for
 * the same reason `CoordinateSpaceRow.kind` is in `gardens-mapping`: the
 * migration's CHECK constrains the vocabulary (today: `'residential'` only),
 * and a Kysely row type describes what a column returns, not the CHECK's
 * current vocabulary.
 */
export interface ClientEngagementRow {
  id: string;
  garden_id: string;
  service_organization_id: string | null;
  state: Generated<string>;
  stewardship_policy: Generated<string>;
  client_notifications_enabled: Generated<boolean>;
  created_by_profile_id: string;
  activated_at: Date | null;
  ended_at: Date | null;
  revoked_at: Date | null;
  revoked_reason: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

/**
 * Mirrors `collaboration.client_access_grant`. `client_profile_id` and
 * `invited_email` are both nullable because a grant identifies its client
 * either by a bound profile or by an invitation target that has not yet been
 * accepted — see the migration's own "WHY `client_access_grant` HAS NO
 * TOKEN" comment. No token/expiry columns exist here on purpose: that
 * mechanism belongs to P9C-INVITE-01.
 */
export interface ClientAccessGrantRow {
  id: string;
  engagement_id: string;
  client_profile_id: string | null;
  invited_email: string | null;
  state: Generated<string>;
  granted_at: Date | null;
  revoked_at: Date | null;
  created_at: Generated<Date>;
}

/**
 * Mirrors `collaboration.work_log` (P9C-DATA-01). Immutable by application
 * discipline only — see the migration's own header for why this table
 * carries ordinary default grants rather than the REVOKE posture the eight
 * tables below it use. `assignmentId`/`taskId` are both nullable: a
 * household work log has neither.
 */
export interface WorkLogRow {
  id: string;
  garden_id: string;
  assignment_id: string | null;
  task_id: string | null;
  actor_profile_id: string;
  description: string;
  occurred_at: Date;
  created_at: Generated<Date>;
}

/**
 * Mirrors `collaboration.client_update` — the mutable
 * `internal_draft -> ready_for_client -> published -> withdrawn` draft row.
 * `state` is `Generated<string>` for the same reason
 * `ClientEngagementRow.state` is: the migration's CHECK constrains the
 * vocabulary, a Kysely row type only describes what the column returns.
 */
export interface ClientUpdateRow {
  id: string;
  engagement_id: string;
  garden_id: string;
  state: Generated<string>;
  title: string;
  summary: string | null;
  revision: Generated<number>;
  created_by_profile_id: string;
  submitted_at: Date | null;
  published_at: Date | null;
  published_by_profile_id: string | null;
  withdrawn_at: Date | null;
  withdrawn_by_profile_id: string | null;
  withdrawn_reason: string | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

/**
 * Mirrors `collaboration.publication_version` — the immutable version
 * created once a `client_update` reaches `'published'`. See the migration's
 * own header for why UPDATE/DELETE are REVOKEd from `verdery_application`
 * on this table and its seven siblings below.
 */
export interface PublicationVersionRow {
  id: string;
  client_update_id: string;
  engagement_id: string;
  garden_id: string;
  version_number: Generated<number>;
  title: string;
  summary: string;
  client_update_revision_at_publish: number;
  published_at: Date;
  published_by_profile_id: string;
  created_at: Generated<Date>;
}

/**
 * Mirrors `collaboration.publication_item` — the discriminated parent for
 * every timeline-ordered publication item. `kind` is `Generated<string>` for
 * the same reason `ClientUpdateRow.state` is.
 */
export interface PublicationItemRow {
  id: string;
  publication_version_id: string;
  garden_id: string;
  kind: Generated<string>;
  occurred_at: Date;
  created_at: Generated<Date>;
}

/** Mirrors `collaboration.publication_work_log_detail` — the `kind = 'work_log'` snapshot. `sourceWorkLogId` is provenance only; never read to render client content. */
export interface PublicationWorkLogDetailRow {
  item_id: string;
  description: string;
  source_work_log_id: string | null;
}

/** Mirrors `collaboration.publication_media_detail` — the `kind = 'media'` snapshot. `mediaRecordId` carries no foreign key at the database layer; see the migration's own header. */
export interface PublicationMediaDetailRow {
  item_id: string;
  media_record_id: string;
  media_role: string;
  caption: string | null;
}

/** Mirrors `collaboration.publication_garden_snapshot_detail` — the `kind = 'garden_snapshot'` snapshot. `snapshotData` is an optional, ungrounded-shape-free structured supplement to the required narrative overview. */
export interface PublicationGardenSnapshotDetailRow {
  item_id: string;
  overview_text: string;
  snapshot_data: string | null;
}

/** Mirrors `collaboration.publication_timeline_entry_detail` — the `kind = 'timeline_entry'` snapshot: an explicitly curated narrative fact. */
export interface PublicationTimelineEntryDetailRow {
  item_id: string;
  entry_text: string;
}

/**
 * Mirrors `collaboration.publication_staff_attribution` — explicitly
 * selected staff display attribution, deliberately NOT a `publication_item`
 * kind (no meaningful `occurred_at`; see the migration's own header).
 * `displayName` is a snapshot, never a live join to `identity_access.profile`.
 */
export interface PublicationStaffAttributionRow {
  id: string;
  publication_version_id: string;
  staff_profile_id: string;
  display_name: string;
  role_label: string | null;
  created_at: Generated<Date>;
}

/**
 * Mirrors `collaboration.media_entitlement` — the AUTHORIZATION fact ("may
 * this engagement read this exact media object"), kept separate from
 * `PublicationMediaDetailRow`'s DISPLAY fact. Withdrawal never writes to
 * this table; see the migration's own header, "WITHDRAWAL NEVER TOUCHES
 * `media_entitlement`".
 */
export interface MediaEntitlementRow {
  id: string;
  engagement_id: string;
  publication_version_id: string;
  media_record_id: string;
  created_at: Generated<Date>;
}

/**
 * Mirrors `collaboration.publisher_grant` (P9C-PUBLISH-01) — the separate,
 * explicit publisher capability ADR-0012's "Publication Boundary" section
 * names, kept independent of `manageEngagement`/`manageGarden`. See the
 * migration's own header, "WHY A NEW GRANT TABLE".
 */
export interface PublisherGrantRow {
  id: string;
  engagement_id: string;
  profile_id: string;
  state: Generated<string>;
  granted_by_profile_id: string;
  granted_at: Generated<Date>;
  revoked_at: Date | null;
  revoked_by_profile_id: string | null;
  created_at: Generated<Date>;
}

/**
 * Mirrors `collaboration.client_update_item` (P9C-PUBLISH-01) — the mutable
 * staging set a publisher builds while a `client_update` sits in
 * `internal_draft`, copied from at publish time into the immutable
 * `publication_item`/detail tables. See the migration's own header,
 * "CLIENT_UPDATE_ITEM".
 */
export interface ClientUpdateItemRow {
  id: string;
  client_update_id: string;
  kind: Generated<string>;
  occurred_at: Date;
  source_work_log_id: string | null;
  description: string | null;
  media_record_id: string | null;
  media_role: string | null;
  caption: string | null;
  created_at: Generated<Date>;
}

export interface CollaborationDatabaseSchema {
  'collaboration.service_organization': ServiceOrganizationRow;
  'collaboration.organization_membership': OrganizationMembershipRow;
  'collaboration.organization_membership_period': OrganizationMembershipPeriodRow;
  'collaboration.garden_assignment': GardenAssignmentRow;
  'collaboration.client_engagement': ClientEngagementRow;
  'collaboration.client_access_grant': ClientAccessGrantRow;
  'collaboration.work_log': WorkLogRow;
  'collaboration.client_update': ClientUpdateRow;
  'collaboration.publication_version': PublicationVersionRow;
  'collaboration.publication_item': PublicationItemRow;
  'collaboration.publication_work_log_detail': PublicationWorkLogDetailRow;
  'collaboration.publication_media_detail': PublicationMediaDetailRow;
  'collaboration.publication_garden_snapshot_detail': PublicationGardenSnapshotDetailRow;
  'collaboration.publication_timeline_entry_detail': PublicationTimelineEntryDetailRow;
  'collaboration.publication_staff_attribution': PublicationStaffAttributionRow;
  'collaboration.media_entitlement': MediaEntitlementRow;
  'collaboration.publisher_grant': PublisherGrantRow;
  'collaboration.client_update_item': ClientUpdateItemRow;
}
