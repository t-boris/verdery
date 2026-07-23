import { sql, type Kysely } from 'kysely';
import type { DatabaseSchema } from '../../../platform/database/database-gateway.js';
import type {
  SyncClientInstallation,
  SyncClientPlatform,
} from '../domain/sync-client-installation.js';
import type {
  RegisterOrRefreshInstallationInput,
  RegisterOrRefreshInstallationResult,
  SyncClientInstallationRepository,
} from '../application/sync-client-installation-repository.js';

interface SyncClientInstallationRowWithInsertedFlag {
  id: string;
  profile_id: string;
  platform: SyncClientPlatform;
  app_version: string;
  protocol_version: number;
  registered_at: Date;
  last_seen_at: Date;
  was_created: boolean;
}

function toInstallation(row: SyncClientInstallationRowWithInsertedFlag): SyncClientInstallation {
  return {
    id: row.id,
    profileId: row.profile_id,
    platform: row.platform,
    appVersion: row.app_version,
    protocolVersion: row.protocol_version,
    registeredAt: row.registered_at,
    lastSeenAt: row.last_seen_at,
  };
}

export class KyselySyncClientInstallationRepository implements SyncClientInstallationRepository {
  constructor(private readonly db: Kysely<DatabaseSchema>) {}

  async registerOrRefresh(
    input: RegisterOrRefreshInstallationInput,
  ): Promise<RegisterOrRefreshInstallationResult> {
    // `xmax = 0` is the standard PostgreSQL "was this row just inserted, not
    // updated" test for an `INSERT ... ON CONFLICT DO UPDATE` statement — an
    // updated row's `xmax` is set to the current transaction's id, while a
    // freshly inserted one's stays `0`. This is what distinguishes the
    // `201`/`200` response the OpenAPI operation documents in one round trip,
    // without a separate existence check racing the write.
    const row = await this.db
      .insertInto('platform.sync_client_installation')
      .values({
        id: input.id,
        profile_id: input.profileId,
        platform: input.platform,
        app_version: input.appVersion,
        protocol_version: input.protocolVersion,
        registered_at: input.now,
        last_seen_at: input.now,
      })
      .onConflict((oc) =>
        oc.column('id').doUpdateSet({
          profile_id: input.profileId,
          platform: input.platform,
          app_version: input.appVersion,
          protocol_version: input.protocolVersion,
          last_seen_at: input.now,
        }),
      )
      .returning([
        'id',
        'profile_id',
        'platform',
        'app_version',
        'protocol_version',
        'registered_at',
        'last_seen_at',
        sql<boolean>`(xmax = 0)`.as('was_created'),
      ])
      .executeTakeFirstOrThrow();

    return {
      installation: toInstallation(row),
      wasCreated: row.was_created,
    };
  }
}
