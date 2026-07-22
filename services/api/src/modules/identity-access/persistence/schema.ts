import type { Generated } from 'kysely';

export interface ProfileRow {
  id: string;
  firebase_uid: string;
  account_state: string;
  locale: string;
  time_zone: string;
  // A JS number, not the string node-postgres would return for bigint: a
  // profile revision advancing by one per accepted mutation cannot approach
  // Number.MAX_SAFE_INTEGER within the service's realistic lifetime.
  revision: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface IdentityProviderLinkRow {
  id: string;
  profile_id: string;
  provider: string;
  provider_uid: string;
  verified_email: string | null;
  linked_at: Generated<Date>;
}

export interface ConsentRecordRow {
  id: string;
  profile_id: string;
  consent_type: string;
  consent_version: string;
  granted_at: Generated<Date>;
}

export interface IdentityAccessDatabaseSchema {
  'identity_access.profile': ProfileRow;
  'identity_access.identity_provider_link': IdentityProviderLinkRow;
  'identity_access.consent_record': ConsentRecordRow;
}
