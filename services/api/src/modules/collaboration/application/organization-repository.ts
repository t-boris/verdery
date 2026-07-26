import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { OrganizationRole } from '../domain/organization-role.js';
import type { ServiceOrganization } from '../domain/service-organization.js';

/** A `ServiceOrganization` paired with the listing profile's own role — mirrors `GardenWithCallerRole`. */
export interface ServiceOrganizationWithCallerRole extends ServiceOrganization {
  readonly callerRole: OrganizationRole;
}

export interface OrganizationRepository {
  findById(id: Uuid): Promise<ServiceOrganization | null>;

  insert(organization: ServiceOrganization): Promise<void>;

  /**
   * Every organization the profile has ACTIVE membership on, most recently
   * created first — the organization-scoped mirror of
   * `GardenRepository.listForProfile`. Deliberately not cursor-paginated:
   * unlike gardens, nothing in this package's scope needs a paginated
   * organization roster, and a professional realistically belongs to very
   * few organizations. Adding pagination later is additive if that ever
   * changes.
   */
  listForProfile(profileId: Uuid): Promise<ServiceOrganizationWithCallerRole[]>;
}
