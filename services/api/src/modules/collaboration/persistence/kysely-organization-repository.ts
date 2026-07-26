import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type {
  OrganizationRepository,
  ServiceOrganizationWithCallerRole,
} from '../application/organization-repository.js';
import type { OrganizationRole } from '../domain/organization-role.js';
import type { ServiceOrganization } from '../domain/service-organization.js';

interface ServiceOrganizationRowShape {
  id: string;
  name: string;
  revision: number;
  created_at: Date;
  updated_at: Date;
}

function toServiceOrganization(row: ServiceOrganizationRowShape): ServiceOrganization {
  return {
    id: row.id,
    name: row.name,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class KyselyOrganizationRepository implements OrganizationRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async findById(id: Uuid): Promise<ServiceOrganization | null> {
    const row = await this.db
      .selectFrom('collaboration.service_organization')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();

    return row === undefined ? null : toServiceOrganization(row);
  }

  async insert(organization: ServiceOrganization): Promise<void> {
    await this.db
      .insertInto('collaboration.service_organization')
      .values({
        id: organization.id,
        name: organization.name,
        revision: organization.revision,
        created_at: organization.createdAt,
        updated_at: organization.updatedAt,
      })
      .execute();
  }

  async listForProfile(profileId: Uuid): Promise<ServiceOrganizationWithCallerRole[]> {
    const rows = await this.db
      .selectFrom('collaboration.service_organization')
      .innerJoin(
        'collaboration.organization_membership',
        'collaboration.organization_membership.organization_id',
        'collaboration.service_organization.id',
      )
      .select([
        'collaboration.service_organization.id as id',
        'collaboration.service_organization.name as name',
        'collaboration.service_organization.revision as revision',
        'collaboration.service_organization.created_at as created_at',
        'collaboration.service_organization.updated_at as updated_at',
        'collaboration.organization_membership.role as caller_role',
      ])
      .where('collaboration.organization_membership.profile_id', '=', profileId)
      .where('collaboration.organization_membership.state', '=', 'active')
      .orderBy('collaboration.service_organization.created_at', 'desc')
      .execute();

    return rows.map((row) => ({
      ...toServiceOrganization(row),
      callerRole: row.caller_role as OrganizationRole,
    }));
  }
}
