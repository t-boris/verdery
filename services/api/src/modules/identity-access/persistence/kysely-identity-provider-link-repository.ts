import type { Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { IdentityProviderLinkRepository } from '../application/identity-provider-link-repository.js';

export class KyselyIdentityProviderLinkRepository implements IdentityProviderLinkRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async link(
    profileId: Uuid,
    provider: string,
    providerUid: string,
    verifiedEmail: string | undefined,
    linkedAt: Date,
  ): Promise<void> {
    await this.db
      .insertInto('identity_access.identity_provider_link')
      .values({
        id: generateUuidV7(),
        profile_id: profileId,
        provider,
        provider_uid: providerUid,
        verified_email: verifiedEmail ?? null,
        linked_at: linkedAt,
      })
      .onConflict((oc) =>
        oc.columns(['profile_id', 'provider']).doUpdateSet({
          provider_uid: providerUid,
          verified_email: verifiedEmail ?? null,
          linked_at: linkedAt,
        }),
      )
      .execute();
  }
}
