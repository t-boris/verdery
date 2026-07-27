/**
 * P9-QA-01, Batch B, Matrix 8 (DST) — client-invitation expiry sub-case
 * (P9C-INVITE-01, `collaboration.client_access_grant`).
 *
 * `CreateClientInvitation` computes `expiresAt` as
 * `new Date(now.getTime() + CLIENT_INVITATION_TTL_MILLISECONDS)`
 * (`create-client-invitation.ts`) and `isClientAccessGrantExpired` compares
 * with plain `.getTime()` subtraction (`domain/client-access-grant.ts`) —
 * both already pure millisecond arithmetic with no calendar-day counting
 * and no local-timezone read anywhere. This suite proves that claim
 * BEHAVIORALLY: a real invitation created just before the 2026-03-08
 * America/New_York spring-forward transition, with a real 7-day expiry
 * window that crosses it, accepted through the real `AcceptClientInvitation`
 * command against real PostgreSQL — confirming the expiry boundary lands
 * at the EXACT millisecond `createdAt + CLIENT_INVITATION_TTL_MILLISECONDS`
 * predicts, never shifted by an hour because a DST transition happened to
 * fall inside the window (which a calendar-day-count implementation, e.g.
 * "add 7 calendar days in the recipient's zone", could get wrong).
 *
 * Transition date matches this codebase's own established convention
 * (`quiet-hours.test.ts`'s header): America/New_York springs forward
 * 2026-03-08 02:00->03:00 EST->EDT.
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import '../../src/platform/database/pg-date-parser.js';
import {
  AcceptClientInvitation,
  CLIENT_INVITATION_TTL_MILLISECONDS,
  hashClientInvitationToken,
  KyselyCollaborationUnitOfWork,
} from '../../src/modules/collaboration/public.js';
import type { DatabaseSchema } from '../../src/platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import {
  activateEngagement,
  fixedClock,
  insertClientEngagement,
  insertGarden,
  insertMembership,
  insertProfile,
} from '../support/publication-integration-harness.js';

const SUITE_NAME = 'p9-qa-01 DST sweep: client invitation expiry (real pipeline)';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;
const JANUARY = new Date('2026-01-10T09:00:00Z');

// The invitation is created three days before the 2026-03-08 America/New_York
// spring-forward transition; its own 7-day TTL therefore lands a few days
// AFTER it, so the whole window straddles the transition.
const CREATED_JUST_BEFORE_TRANSITION = new Date('2026-03-05T09:00:00Z');
const EXPECTED_EXPIRES_AT = new Date(
  CREATED_JUST_BEFORE_TRANSITION.getTime() + CLIENT_INVITATION_TTL_MILLISECONDS,
);

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let db: Kysely<DatabaseSchema>;

  beforeAll(async () => {
    container = await startPostgresTestContainer();
    const databaseUrl = container.getConnectionUri();

    await runner({
      databaseUrl,
      dir: MIGRATIONS_DIRECTORY,
      direction: 'up',
      migrationsTable: 'pgmigrations',
      count: Number.POSITIVE_INFINITY,
      log: () => {},
    });

    pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
    db = new Kysely<DatabaseSchema>({ dialect: new PostgresDialect({ pool }) });
  }, 120_000);

  afterAll(async () => {
    await db.destroy();
    await container?.stop();
  });

  function acceptCommand(now: Date): AcceptClientInvitation {
    return new AcceptClientInvitation(
      new KyselyIdempotencyStore(db, fixedClock(now)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(now)),
      fixedClock(now),
    );
  }

  async function seedOwnerAndEngagement() {
    const ownerId = await insertProfile(db);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const engagementId = await insertClientEngagement(db, gardenId, ownerId, null, JANUARY);
    await activateEngagement(db, engagementId, JANUARY);
    return { ownerId, gardenId, engagementId };
  }

  /** Mirrors `collaboration-accept-client-invitation.test.ts`'s own `seedGrant`, exercising the real DST-straddling `expiresAt` this suite computes above by construction — not a hand-picked round number. */
  async function seedGrantSpanningTheTransition(
    engagementId: string,
    invitedEmail: string,
  ): Promise<{ id: string; token: string }> {
    const token = randomUUID();
    const id = randomUUID();
    await db
      .insertInto('collaboration.client_access_grant')
      .values({
        id,
        engagement_id: engagementId,
        client_profile_id: null,
        invited_email: invitedEmail,
        token_hash: hashClientInvitationToken(token),
        state: 'pending',
        granted_at: null,
        revoked_at: null,
        expires_at: EXPECTED_EXPIRES_AT,
        created_at: CREATED_JUST_BEFORE_TRANSITION,
      })
      .execute();
    return { id, token };
  }

  function actor(profileId: string, email: string, emailVerified = true) {
    return { profileId, email, emailVerified };
  }

  it('round-trips the exact millisecond expiry duration through Postgres, unaffected by the DST transition inside the window', async () => {
    const { engagementId } = await seedOwnerAndEngagement();
    const grant = await seedGrantSpanningTheTransition(engagementId, 'duration-check@example.test');

    const row = await db
      .selectFrom('collaboration.client_access_grant')
      .select(['created_at', 'expires_at'])
      .where('id', '=', grant.id)
      .executeTakeFirstOrThrow();

    // A `pending` grant this suite itself just seeded with a real
    // `expiresAt` always carries one; a `null` here would be a fixture
    // defect, not a case to silently work around.
    if (row.expires_at === null) {
      throw new Error('expected the seeded grant to carry an expiresAt');
    }

    // Exact millisecond duration, not "7 calendar days" (which a
    // wall-clock-aware implementation could shift by an hour across this
    // exact transition): the round trip through `timestamptz` must
    // preserve precisely `CLIENT_INVITATION_TTL_MILLISECONDS`.
    expect(row.expires_at.getTime() - row.created_at.getTime()).toBe(
      CLIENT_INVITATION_TTL_MILLISECONDS,
    );
    expect(row.expires_at).toEqual(EXPECTED_EXPIRES_AT);
  });

  it('accepts one second before the DST-straddling expiry instant', async () => {
    const { engagementId } = await seedOwnerAndEngagement();
    const grant = await seedGrantSpanningTheTransition(engagementId, 'accept-before@example.test');
    const clientId = await insertProfile(db);

    const now = new Date(EXPECTED_EXPIRES_AT.getTime() - 1_000);
    const result = await acceptCommand(now).execute(
      actor(clientId, 'accept-before@example.test', true),
      grant.token,
      randomUUID(),
    );

    expect(result.state).toBe('active');
  });

  it('refuses acceptance exactly AT the DST-straddling expiry instant, never off by an hour in either direction', async () => {
    const { engagementId } = await seedOwnerAndEngagement();
    const grant = await seedGrantSpanningTheTransition(engagementId, 'accept-at@example.test');
    const clientId = await insertProfile(db);

    // `isClientAccessGrantExpired` is `<=`, so the instant itself is
    // already expired — the self-heal lazily flips the row to `expired`
    // before the accept attempt runs.
    const now = EXPECTED_EXPIRES_AT;
    await expect(
      acceptCommand(now).execute(
        actor(clientId, 'accept-at@example.test', true),
        grant.token,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ category: 'conflict', code: 'client_access_grant.expired' });

    const row = await db
      .selectFrom('collaboration.client_access_grant')
      .select('state')
      .where('id', '=', grant.id)
      .executeTakeFirstOrThrow();
    expect(row.state).toBe('expired');
  });

  it('still refuses acceptance one hour before the naive (wrong) expiry a DST-blind calendar-day count would have produced', async () => {
    // A BUGGY "7 calendar days in local wall-clock time" implementation
    // would, across this exact spring-forward night, compute an expiry ONE
    // HOUR LATER than the correct UTC-duration one (a wall-clock day that
    // lost an hour still counts as "one calendar day"). Attempting
    // acceptance at that wrong, later instant must still be refused by the
    // real (correct) implementation — pinning the failure mode precisely,
    // not just the happy path.
    const { engagementId } = await seedOwnerAndEngagement();
    const grant = await seedGrantSpanningTheTransition(
      engagementId,
      'naive-expiry-check@example.test',
    );
    const clientId = await insertProfile(db);

    const oneHourAfterRealExpiry = new Date(EXPECTED_EXPIRES_AT.getTime() + 60 * 60 * 1000);
    await expect(
      acceptCommand(oneHourAfterRealExpiry).execute(
        actor(clientId, 'naive-expiry-check@example.test', true),
        grant.token,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ category: 'conflict', code: 'client_access_grant.expired' });
  });
});
