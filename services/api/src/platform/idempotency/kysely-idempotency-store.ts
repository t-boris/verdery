import { SharedErrorCode } from '@verdery/api-contracts';
import type { Kysely } from 'kysely';
import { ConflictError } from '../errors/application-error.js';
import type { DatabaseSchema } from '../database/database-gateway.js';
import type { Clock } from '../../shared/time/clock.js';
import type {
  IdempotencyCheck,
  IdempotencyLookupResult,
  IdempotencyRecordInput,
  IdempotencyStore,
} from './idempotency-store.js';

export class KyselyIdempotencyStore implements IdempotencyStore {
  constructor(
    private readonly db: Kysely<DatabaseSchema>,
    private readonly clock: Clock,
  ) {}

  async check(input: IdempotencyRecordInput): Promise<IdempotencyCheck> {
    const existing = await this.db
      .selectFrom('platform.idempotency_record')
      .select(['request_fingerprint', 'response_status_code', 'response_body'])
      .where('actor_profile_id', '=', input.actorProfileId)
      .where('operation', '=', input.operation)
      .where('idempotency_key', '=', input.idempotencyKey)
      .executeTakeFirst();

    if (existing === undefined) {
      return { kind: 'new' };
    }

    if (existing.request_fingerprint !== input.requestFingerprint) {
      throw new ConflictError(
        SharedErrorCode.IdempotencyKeyReused,
        'This idempotency key was already used with a different request.',
      );
    }

    return {
      kind: 'replay',
      responseStatusCode: existing.response_status_code,
      responseBody: existing.response_body,
    };
  }

  async save(
    input: IdempotencyRecordInput,
    responseStatusCode: number,
    responseBody: unknown,
    ttlMilliseconds: number,
  ): Promise<void> {
    await this.db
      .insertInto('platform.idempotency_record')
      .values({
        actor_profile_id: input.actorProfileId,
        operation: input.operation,
        idempotency_key: input.idempotencyKey,
        request_fingerprint: input.requestFingerprint,
        response_status_code: responseStatusCode,
        response_body: JSON.stringify(responseBody),
        expires_at: new Date(this.clock.now().getTime() + ttlMilliseconds),
      })
      .execute();
  }

  async lookup(
    actorProfileId: string,
    operation: string,
    idempotencyKey: string,
  ): Promise<IdempotencyLookupResult | null> {
    const existing = await this.db
      .selectFrom('platform.idempotency_record')
      .select(['response_status_code', 'response_body'])
      .where('actor_profile_id', '=', actorProfileId)
      .where('operation', '=', operation)
      .where('idempotency_key', '=', idempotencyKey)
      .executeTakeFirst();

    if (existing === undefined) {
      return null;
    }

    return {
      responseStatusCode: existing.response_status_code,
      responseBody: existing.response_body,
    };
  }
}
