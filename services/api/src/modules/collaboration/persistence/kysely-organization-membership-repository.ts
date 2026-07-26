import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  OrganizationMembershipDetail,
  OrganizationMembershipPeriodEndedReason,
  OrganizationMembershipPeriodInput,
  OrganizationMembershipRepository,
  OrganizationMembershipState,
} from '../application/organization-membership-repository.js';
import type { OrganizationRole } from '../domain/organization-role.js';

interface OrganizationMembershipRowShape {
  id: string;
  organization_id: string;
  profile_id: string;
  role: string;
  state: string;
  created_at: Date;
  updated_at: Date;
}

function toDetail(row: OrganizationMembershipRowShape): OrganizationMembershipDetail {
  return {
    id: row.id,
    organizationId: row.organization_id,
    profileId: row.profile_id,
    role: row.role as OrganizationRole,
    state: row.state as OrganizationMembershipState,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECTED_COLUMNS = [
  'id',
  'organization_id',
  'profile_id',
  'role',
  'state',
  'created_at',
  'updated_at',
] as const;

export class KyselyOrganizationMembershipRepository implements OrganizationMembershipRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async findActiveByOrganizationAndProfile(
    organizationId: Uuid,
    profileId: Uuid,
  ): Promise<OrganizationMembershipDetail | null> {
    const row = await this.db
      .selectFrom('collaboration.organization_membership')
      .select(SELECTED_COLUMNS)
      .where('organization_id', '=', organizationId)
      .where('profile_id', '=', profileId)
      .where('state', '=', 'active')
      .executeTakeFirst();

    return row === undefined ? null : toDetail(row);
  }

  async findByOrganizationAndProfile(
    organizationId: Uuid,
    profileId: Uuid,
  ): Promise<OrganizationMembershipDetail | null> {
    const row = await this.db
      .selectFrom('collaboration.organization_membership')
      .select(SELECTED_COLUMNS)
      .where('organization_id', '=', organizationId)
      .where('profile_id', '=', profileId)
      .executeTakeFirst();

    return row === undefined ? null : toDetail(row);
  }

  async insert(
    id: Uuid,
    organizationId: Uuid,
    profileId: Uuid,
    role: OrganizationRole,
    now: Date,
  ): Promise<void> {
    await this.db
      .insertInto('collaboration.organization_membership')
      .values({
        id,
        organization_id: organizationId,
        profile_id: profileId,
        role,
        state: 'active',
        created_at: now,
        updated_at: now,
      })
      .execute();
  }

  async listActiveForOrganization(organizationId: Uuid): Promise<OrganizationMembershipDetail[]> {
    const rows = await this.db
      .selectFrom('collaboration.organization_membership')
      .select(SELECTED_COLUMNS)
      .where('organization_id', '=', organizationId)
      .where('state', '=', 'active')
      .orderBy('created_at', 'asc')
      .execute();

    return rows.map(toDetail);
  }

  async lockActiveAdminIds(organizationId: Uuid): Promise<readonly Uuid[]> {
    const rows = await this.db
      .selectFrom('collaboration.organization_membership')
      .select('id')
      .where('organization_id', '=', organizationId)
      .where('role', '=', 'organization_admin')
      .where('state', '=', 'active')
      .orderBy('id', 'asc')
      .forUpdate()
      .execute();

    return rows.map((row) => row.id);
  }

  async lockMembership(membershipId: Uuid): Promise<OrganizationMembershipDetail | null> {
    const row = await this.db
      .selectFrom('collaboration.organization_membership')
      .select(SELECTED_COLUMNS)
      .where('id', '=', membershipId)
      .forUpdate()
      .executeTakeFirst();

    return row === undefined ? null : toDetail(row);
  }

  async changeRole(membershipId: Uuid, role: OrganizationRole, now: Date): Promise<void> {
    await this.db
      .updateTable('collaboration.organization_membership')
      .set({ role, updated_at: now })
      .where('id', '=', membershipId)
      .execute();
  }

  async setState(membershipId: Uuid, state: OrganizationMembershipState, now: Date): Promise<void> {
    await this.db
      .updateTable('collaboration.organization_membership')
      .set({ state, updated_at: now })
      .where('id', '=', membershipId)
      .execute();
  }

  async openPeriod(input: OrganizationMembershipPeriodInput): Promise<void> {
    await this.db
      .insertInto('collaboration.organization_membership_period')
      .values({
        id: input.id,
        membership_id: input.membershipId,
        organization_id: input.organizationId,
        profile_id: input.profileId,
        role: input.role,
        valid_from: input.validFrom,
        valid_until: null,
        ended_reason: null,
      })
      .execute();
  }

  async closeOpenPeriod(
    membershipId: Uuid,
    validUntil: Date,
    endedReason: OrganizationMembershipPeriodEndedReason,
  ): Promise<void> {
    await this.db
      .updateTable('collaboration.organization_membership_period')
      .set({ valid_until: validUntil, ended_reason: endedReason })
      .where('membership_id', '=', membershipId)
      .where('valid_until', 'is', null)
      .execute();
  }
}
