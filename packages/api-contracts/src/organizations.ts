/**
 * The professional-service domain's contract surface (P9B-API-01): service
 * organizations, organization membership, garden assignment, and client
 * engagement lifecycle — split out of `index.ts` purely for the
 * repository's 600-line source-file rule; `index.ts` re-exports everything
 * here, so consumers keep importing from `@verdery/api-contracts`
 * unchanged. The same "hand-written or generated material grew past the
 * limit" split `media-processing.ts`/`export-processing.ts` already
 * establish, applied here to a plain OpenAPI-generated type/error-code
 * group rather than a hand-written machine-to-machine contract.
 */

import type { components } from './generated/schema.js';

type Schemas = components['schemas'];

/**
 * The professional-service domain schemas (P9B-API-01): service
 * organizations, organization membership, garden assignment, and client
 * engagement lifecycle.
 */
export type OrganizationRole = Schemas['OrganizationRole'];
export type ServiceOrganization = Schemas['ServiceOrganization'];
export type ServiceOrganizationListResult = Schemas['ServiceOrganizationListResult'];
export type CreateServiceOrganizationRequest = Schemas['CreateServiceOrganizationRequest'];
export type OrganizationMemberState = Schemas['OrganizationMemberState'];
export type OrganizationMember = Schemas['OrganizationMember'];
export type OrganizationMemberListResult = Schemas['OrganizationMemberListResult'];
export type AddOrganizationMemberRequest = Schemas['AddOrganizationMemberRequest'];
export type ChangeOrganizationMemberRoleRequest = Schemas['ChangeOrganizationMemberRoleRequest'];
export type GardenAssignmentRole = Schemas['GardenAssignmentRole'];
export type GardenAssignmentState = Schemas['GardenAssignmentState'];
export type GardenAssignment = Schemas['GardenAssignment'];
export type GardenAssignmentListResult = Schemas['GardenAssignmentListResult'];
export type CreateGardenAssignmentRequest = Schemas['CreateGardenAssignmentRequest'];
export type ClientEngagementState = Schemas['ClientEngagementState'];
export type StewardshipPolicy = Schemas['StewardshipPolicy'];
export type ClientEngagement = Schemas['ClientEngagement'];
export type ClientEngagementListResult = Schemas['ClientEngagementListResult'];
export type CreateClientEngagementRequest = Schemas['CreateClientEngagementRequest'];
export type RevokeClientEngagementRequest = Schemas['RevokeClientEngagementRequest'];

/**
 * Error codes the professional-service domain's organization and garden-
 * assignment endpoints raise (P9B-API-01).
 *
 * Organization non-existence and non-membership are concealed as `notFound`
 * identically — the same posture `GardenErrorCode.NotFound` documents for
 * gardens: a caller must not learn that an organization id exists if they
 * cannot see it. `AssignmentNotFound` extends the same posture across
 * organizations: a caller must not learn that an assignment id exists under
 * an organization other than the one they administer.
 */
export const OrganizationErrorCode = {
  /** No organization exists at this id, or the caller has no ACTIVE membership on it. */
  NotFound: 'organization.not_found',
  /** No profile exists at the id `addOrganizationMember` named. */
  ProfileNotFound: 'organization.membership.profile_not_found',
  /** No ACTIVE membership exists at this profile on this organization, or the caller lacks visibility into it. */
  MembershipNotFound: 'organization.membership.not_found',
  /** The named profile already has a membership record (active or removed) on this organization — `organization_membership_org_profile_key`'s own one-row-per-pair-forever constraint. */
  MembershipAlreadyExists: 'organization.membership.already_exists',
  /** The command would leave the organization with no active `organizationAdmin`. */
  LastAdminRequired: 'organization.membership.last_admin_required',
  /** No assignment exists at this id on this organization. */
  AssignmentNotFound: 'organization.assignment.not_found',
  /** The named profile already holds an ACTIVE assignment on this garden (`garden_assignment_active_key`'s own invariant). */
  AssignmentAlreadyActive: 'organization.assignment.already_active',
  /** `createGardenAssignment` named a profile who is not an ACTIVE member of the organization making the assignment. */
  AssigneeNotOrganizationMember: 'organization.assignment.assignee_not_member',
  /** `endGardenAssignment`/`revokeGardenAssignment` was asked to move an assignment already in the OTHER terminal state (`ended` versus `revoked`) — both terminal, neither reachable from the other. */
  AssignmentInvalidTransition: 'organization.assignment.invalid_transition',
} as const;

export type OrganizationErrorCode =
  (typeof OrganizationErrorCode)[keyof typeof OrganizationErrorCode];

/**
 * Error codes the client-engagement lifecycle endpoints raise (P9B-API-01).
 *
 * Non-visibility is concealed as `notFound` — the same posture every other
 * module-specific not-found code in this catalogue already documents.
 */
export const ClientEngagementErrorCode = {
  /** No engagement exists at this id, or the caller is not authorized to act on the organization or garden it names. */
  NotFound: 'client_engagement.not_found',
  /** `activateClientEngagement`/`endClientEngagement`/`revokeClientEngagement` was asked for a transition `client-engagement-state.ts`'s own state diagram does not allow from the engagement's CURRENT state. */
  InvalidTransition: 'client_engagement.invalid_transition',
} as const;

export type ClientEngagementErrorCode =
  (typeof ClientEngagementErrorCode)[keyof typeof ClientEngagementErrorCode];
