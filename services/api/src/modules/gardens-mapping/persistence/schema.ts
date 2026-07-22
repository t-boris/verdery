import type { Generated } from 'kysely';

export interface GardenRow {
  id: string;
  name: string;
  lifecycle_state: string;
  // A JS number, not the string node-postgres would return for bigint: see
  // the identical note on identity_access.profile's revision column.
  revision: Generated<number>;
  created_by_profile_id: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
  deletion_requested_at: Date | null;
}

/** Table lives in the `collaboration` schema; see membership-repository.ts for why this module owns it in Phase 2. */
export interface MembershipRow {
  id: string;
  garden_id: string;
  profile_id: string;
  role: string;
  state: string;
  revision: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface GardensMappingDatabaseSchema {
  'gardens_mapping.garden': GardenRow;
  'collaboration.membership': MembershipRow;
}
