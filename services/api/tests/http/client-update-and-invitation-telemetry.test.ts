/**
 * HTTP-level telemetry tests for P9C-OBS-01's own transport-layer structured
 * log lines — the real Fastify application (`buildTestApplication`), real
 * Kysely repositories/commands against a real migrated PostgreSQL database,
 * and the fake Firebase boundary only. `client-portal-routes.test.ts`
 * already covers `client_portal`/`client_media` denial telemetry and the
 * `client_media.access_granted` audit row; this suite covers the remaining
 * two surfaces `client-invitation-routes.ts`/`client-update-routes.ts` add:
 *
 *   - `client_invitation.accept_completed` / `authorization.denied`
 *     (`surface: 'client_invitation_accept'`) on `POST
 *     /client-invitations/accept`.
 *   - `client_update.publish_completed` / `client_update.withdraw_completed`
 *     / `authorization.denied` (`surface: 'publisher_grant'`) on `POST
 *     .../publish` and `.../withdraw`.
 *
 * Business-logic coverage (state machine, authorization, concurrency) for
 * every command these routes wrap already lives in
 * `collaboration-publications.test.ts`/`collaboration-accept-client-
 * invitation.test.ts` — this suite proves only the ADDITIONAL thing those
 * levels cannot: that the real route emits the real structured log line,
 * and that the line is genuinely privacy-safe (prohibited-content
 * telemetry, P9C-OBS-01's own completion evidence).
 *
 * Source: architecture/collaboration-and-client-sharing.md, section
 * "19. Audit and Observability"; implementation-plan.md work package
 * P9C-OBS-01.
 */

import { randomUUID } from 'node:crypto';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Kysely, PostgresDialect } from 'kysely';
import { runner } from 'node-pg-migrate';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../../src/platform/database/pg-bigint-parser.js';
import '../../src/platform/database/pg-date-parser.js';
import {
  AddClientUpdateItem,
  CreateClientUpdate,
  hashClientInvitationToken,
  KyselyClientEngagementRepository,
  KyselyClientUpdateRepository,
  KyselyCollaborationUnitOfWork,
  KyselyPublisherGrantRepository,
  KyselyWorkLogRepository,
  PublisherAuthorization,
  SubmitClientUpdate,
  UpdateClientUpdateContent,
} from '../../src/modules/collaboration/public.js';
import { KyselyMediaRepository } from '../../src/modules/media/public.js';
import type {
  DatabaseGateway,
  DatabaseSchema,
} from '../../src/platform/database/database-gateway.js';
import { KyselyIdempotencyStore } from '../../src/platform/idempotency/kysely-idempotency-store.js';
import type { TokenVerifier } from '../../src/platform/authentication/token-verifier.js';
import type { VerifiedCredential } from '../../src/platform/authentication/verified-credential.js';
import { generateUuidV7 } from '../../src/shared/identifiers/uuid.js';
import { buildTestApplication } from '../support/application.js';
import { isDockerAvailable, warnDockerUnavailable } from '../support/docker.js';
import { startPostgresTestContainer } from '../support/postgres-container.js';
import {
  activateEngagement,
  fixedClock,
  insertGarden,
  insertMembership,
  insertProfile,
  insertPublisherGrant,
  insertWorkLog,
} from '../support/publication-integration-harness.js';
import type {
  ApiError,
  ClientAccessGrant,
  ClientUpdate,
  PublicationVersion,
} from '@verdery/api-contracts';

type InjectResponse = Awaited<ReturnType<FastifyInstance['inject']>>;

function asPublicationVersion(response: InjectResponse): PublicationVersion {
  return response.json<PublicationVersion>();
}

function asClientUpdate(response: InjectResponse): ClientUpdate {
  return response.json<ClientUpdate>();
}

function asClientAccessGrant(response: InjectResponse): ClientAccessGrant {
  return response.json<ClientAccessGrant>();
}

function asError(response: InjectResponse): ApiError {
  return response.json<ApiError>();
}

const SUITE_NAME = 'client update and invitation telemetry (HTTP)';
const MIGRATIONS_DIRECTORY = new URL('../../migrations', import.meta.url).pathname;
const JANUARY = new Date('2026-01-10T09:00:00Z');
const MARCH = new Date('2026-03-10T09:00:00Z');

const dockerAvailable = await isDockerAvailable();
if (!dockerAvailable) {
  warnDockerUnavailable(SUITE_NAME);
}

/** The identical local-per-suite fake every HTTP suite in this codebase defines, extended with an explicit email so invitation-accept scenarios can bind a caller to a specific invited address. */
class FakeTokenVerifier implements TokenVerifier {
  private readonly credentialsByToken = new Map<string, VerifiedCredential>();

  registerIdToken(
    token: string,
    firebaseUid: string,
    email: string = `${firebaseUid}@example.com`,
    emailVerified = true,
  ): void {
    this.credentialsByToken.set(token, {
      firebaseUid,
      signInProvider: 'google.com',
      providerUid: firebaseUid,
      authenticatedAt: new Date(),
      email,
      emailVerified,
    });
  }

  verifyIdToken(idToken: string): Promise<VerifiedCredential> {
    const credential = this.credentialsByToken.get(idToken);
    if (credential === undefined) {
      return Promise.reject(new Error('unknown test token'));
    }
    return Promise.resolve(credential);
  }

  createSessionCookie(): Promise<string> {
    return Promise.reject(new Error('not used by this suite'));
  }

  verifySessionCookie(sessionCookie: string): Promise<VerifiedCredential> {
    return this.verifyIdToken(sessionCookie);
  }

  revokeRefreshTokens(): Promise<void> {
    return Promise.resolve();
  }
}

describe.skipIf(!dockerAvailable)(SUITE_NAME, () => {
  let container: StartedPostgreSqlContainer;
  let pool: pg.Pool;
  let db: Kysely<DatabaseSchema>;
  let tokenVerifier: FakeTokenVerifier;
  let app: FastifyInstance;
  const logRecords: string[] = [];

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

    const database: DatabaseGateway = {
      queries: db,
      ping: () => Promise.resolve(),
      close: () => db.destroy(),
    };

    tokenVerifier = new FakeTokenVerifier();
    app = await buildTestApplication({
      database,
      tokenVerifier,
      onLogRecord: (record) => logRecords.push(record),
    });
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await db.destroy();
    await container?.stop();
  });

  /** The most recently logged record whose `event` field matches — parsed, not a raw string search. Mirrors `sync-routes.test.ts`'s own identical helper. */
  function lastLogEvent(event: string): Record<string, unknown> | undefined {
    const matches = logRecords
      .map((record) => JSON.parse(record) as Record<string, unknown>)
      .filter((parsed) => parsed['event'] === event);
    return matches.at(-1);
  }

  function bearer(token: string): { authorization: string } {
    return { authorization: `Bearer ${token}` };
  }

  function idempotencyHeaders(token: string, expectedRevision?: number): Record<string, string> {
    return {
      ...bearer(token),
      'idempotency-key': generateUuidV7(),
      ...(expectedRevision === undefined ? {} : { 'if-match': String(expectedRevision) }),
    };
  }

  /**
   * Inserts a `draft` `collaboration.client_engagement` row with a real
   * UUIDv7 id — `organization-integration-harness.ts`'s own
   * `insertClientEngagement` mints a v4 id internally with no override
   * parameter, which is fine for every OTHER integration suite (none of
   * them route through HTTP path parameters), but `requireEngagementId`'s
   * own `UUID_PATTERN` accepts only the v7 shape every real command
   * generates — the identical "a real v7 id, not the fixture's own default
   * v4" note `client-portal-routes.test.ts`'s own `seedActiveClientGarden`
   * already gives for the identical reason.
   */
  async function insertClientEngagementV7(
    gardenId: string,
    createdByProfileId: string,
    createdAt: Date = JANUARY,
  ): Promise<string> {
    const id = generateUuidV7();
    await db
      .insertInto('collaboration.client_engagement')
      .values({
        id,
        garden_id: gardenId,
        service_organization_id: null,
        state: 'draft',
        stewardship_policy: 'residential',
        client_notifications_enabled: true,
        created_by_profile_id: createdByProfileId,
        activated_at: null,
        ended_at: null,
        revoked_at: null,
        revoked_reason: null,
        created_at: createdAt,
        updated_at: createdAt,
      })
      .execute();
    return id;
  }

  /** A real, active engagement with a real, active publisher grant for a known owner. */
  async function seedEngagementWithPublisher() {
    const ownerId = await insertProfile(db);
    const token = randomUUID();
    tokenVerifier.registerIdToken(token, `firebase-${ownerId}`);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const engagementId = await insertClientEngagementV7(gardenId, ownerId, JANUARY);
    await activateEngagement(db, engagementId, JANUARY);
    await insertPublisherGrant(db, engagementId, ownerId, ownerId, JANUARY);
    return { token, ownerId, gardenId, engagementId };
  }

  /** Stages a `ready_for_client` update with exactly one `work_log` item, using the real commands directly — mirrors `collaboration-publications.test.ts`'s own helper shape. */
  async function seedReadyForClientUpdate(
    engagementId: string,
    gardenId: string,
    ownerId: string,
    workLogOccurredAt: Date,
  ): Promise<{ clientUpdateId: string; expectedRevision: number }> {
    const publisherAuthorization = new PublisherAuthorization(
      new KyselyPublisherGrantRepository(db),
    );
    const engagements = new KyselyClientEngagementRepository(db);

    const clientUpdates = new KyselyClientUpdateRepository(db);

    const createCommand = new CreateClientUpdate(
      new KyselyIdempotencyStore(db, fixedClock(MARCH)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(MARCH)),
      publisherAuthorization,
      engagements,
      fixedClock(MARCH),
    );
    const draft = await createCommand.execute(
      engagementId,
      'March visit summary',
      ownerId,
      generateUuidV7(),
    );

    const workLogId = await insertWorkLog(
      db,
      gardenId,
      ownerId,
      'Pruned the roses',
      workLogOccurredAt,
    );
    const addItemCommand = new AddClientUpdateItem(
      new KyselyIdempotencyStore(db, fixedClock(MARCH)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(MARCH)),
      publisherAuthorization,
      engagements,
      clientUpdates,
      new KyselyWorkLogRepository(db),
      new KyselyMediaRepository(db),
      fixedClock(MARCH),
    );
    await addItemCommand.execute(
      engagementId,
      draft.id,
      {
        kind: 'work_log',
        occurredAt: workLogOccurredAt,
        sourceWorkLogId: workLogId,
        description: 'Roses pruned back for spring',
      },
      ownerId,
      generateUuidV7(),
    );

    // `AddClientUpdateItem` never touches `client_update.revision` (its own
    // header comment: "NO REVISION GUARD AGAINST `client_update.revision`"),
    // so `draft.revision` (1) is still the correct `expectedRevision` here.
    const contentCommand = new UpdateClientUpdateContent(
      new KyselyIdempotencyStore(db, fixedClock(MARCH)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(MARCH)),
      publisherAuthorization,
      engagements,
      clientUpdates,
      fixedClock(MARCH),
    );
    const withSummary = await contentCommand.execute(
      engagementId,
      draft.id,
      { summary: 'Roses pruned; beds refreshed for spring.' },
      ownerId,
      draft.revision,
      generateUuidV7(),
    );

    const submitCommand = new SubmitClientUpdate(
      new KyselyIdempotencyStore(db, fixedClock(MARCH)),
      new KyselyCollaborationUnitOfWork(db, fixedClock(MARCH)),
      publisherAuthorization,
      engagements,
      clientUpdates,
      fixedClock(MARCH),
    );
    const submitted = await submitCommand.execute(
      engagementId,
      draft.id,
      ownerId,
      withSummary.revision,
      generateUuidV7(),
    );

    return { clientUpdateId: draft.id, expectedRevision: submitted.revision };
  }

  // --- Publish / withdraw telemetry ---------------------------------------

  it('logs client_update.publish_completed with a computed work-to-publication lag, never publication text', async () => {
    const { token, ownerId, gardenId, engagementId } = await seedEngagementWithPublisher();
    const workLogOccurredAt = new Date('2026-03-05T09:00:00Z');
    const { clientUpdateId, expectedRevision } = await seedReadyForClientUpdate(
      engagementId,
      gardenId,
      ownerId,
      workLogOccurredAt,
    );

    const response = await app.inject({
      method: 'POST',
      url: `/v1/client-engagements/${engagementId}/updates/${clientUpdateId}/publish`,
      headers: idempotencyHeaders(token, expectedRevision),
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    const version = asPublicationVersion(response);
    expect(version.versionNumber).toBe(1);

    const publishLog = lastLogEvent('client_update.publish_completed');
    expect(publishLog).toMatchObject({
      engagementId,
      versionNumber: 1,
      itemCount: 1,
      workLogItemCount: 1,
      mediaItemCount: 0,
      workToPublicationLagMs: new Date(version.publishedAt).getTime() - workLogOccurredAt.getTime(),
    });
    // Prohibited-content telemetry: never the title, summary, or work-log
    // description this publish actually carried.
    const serializedPublishLog = JSON.stringify(publishLog);
    expect(serializedPublishLog).not.toContain('March visit summary');
    expect(serializedPublishLog).not.toContain('Roses pruned');
  });

  it('denies publish for a caller with no publisher grant, logging authorization.denied without any resource identifier', async () => {
    const ownerId = await insertProfile(db);
    const token = randomUUID();
    tokenVerifier.registerIdToken(token, `firebase-${ownerId}`);
    const gardenId = await insertGarden(db, ownerId);
    await insertMembership(db, gardenId, ownerId, 'owner', JANUARY);
    const engagementId = await insertClientEngagementV7(gardenId, ownerId, JANUARY);
    await activateEngagement(db, engagementId, JANUARY);
    // Deliberately NO `insertPublisherGrant` — an engagement owner with no
    // publisher grant, the exact `PublisherAccessRequired` case.

    const response = await app.inject({
      method: 'POST',
      url: `/v1/client-engagements/${engagementId}/updates/${generateUuidV7()}/publish`,
      headers: idempotencyHeaders(token, 1),
      payload: {},
    });

    expect(response.statusCode).toBe(403);
    expect(asError(response).error.code).toBe('client_update.publisher_access_required');

    const denial = lastLogEvent('authorization.denied');
    expect(denial).toMatchObject({ surface: 'publisher_grant', reasonCategory: 'not_entitled' });
    expect(JSON.stringify(denial)).not.toContain(engagementId);
  });

  it('logs client_update.withdraw_completed with only hasReason, never the reason text', async () => {
    const { token, ownerId, gardenId, engagementId } = await seedEngagementWithPublisher();
    const { clientUpdateId, expectedRevision } = await seedReadyForClientUpdate(
      engagementId,
      gardenId,
      ownerId,
      new Date('2026-03-05T09:00:00Z'),
    );

    const published = await app.inject({
      method: 'POST',
      url: `/v1/client-engagements/${engagementId}/updates/${clientUpdateId}/publish`,
      headers: idempotencyHeaders(token, expectedRevision),
      payload: {},
    });
    expect(published.statusCode).toBe(200);
    const publishedUpdate = asPublicationVersion(published);

    const forbiddenReason =
      'INTERNAL-NOTE-marker: client complained about muddy stepping stones near 123 Main St';
    const withdrawn = await app.inject({
      method: 'POST',
      url: `/v1/client-engagements/${engagementId}/updates/${clientUpdateId}/withdraw`,
      headers: idempotencyHeaders(token, publishedUpdate.clientUpdateRevisionAtPublish + 1),
      payload: { reason: forbiddenReason },
    });
    expect(withdrawn.statusCode).toBe(200);
    expect(asClientUpdate(withdrawn).withdrawnReason).toBe(forbiddenReason);

    const withdrawLog = lastLogEvent('client_update.withdraw_completed');
    expect(withdrawLog).toMatchObject({ engagementId, hasReason: true });
    expect(JSON.stringify(withdrawLog)).not.toContain(forbiddenReason);
    expect(JSON.stringify(withdrawLog)).not.toContain('123 Main St');
  });

  // --- Invitation-accept telemetry ----------------------------------------

  /**
   * Inserts a PENDING `collaboration.client_access_grant` row directly,
   * returning the RAW token — mirrors `collaboration-accept-client-
   * invitation.test.ts`'s own `seedGrant` helper. Every scenario this suite
   * needs (a genuine accept, a lapsed one) is reachable from `pending` plus
   * `expiresAt` alone — `AcceptClientInvitation`'s own lazy self-heal turns
   * a past-`expiresAt` `pending` row into the `expired` denial without this
   * fixture needing to pre-set `state: 'expired'` itself.
   */
  async function seedInvitationGrant(
    engagementId: string,
    invitedEmail: string,
    overrides: { readonly expiresAt?: Date } = {},
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
        expires_at: overrides.expiresAt ?? new Date('2026-12-01T09:00:00Z'),
        created_at: JANUARY,
      })
      .execute();
    return { id, token };
  }

  it('logs client_invitation.accept_completed on success, never the token or the email', async () => {
    const { engagementId } = await seedEngagementWithPublisher();
    const email = 'client-telemetry@example.test';
    const grant = await seedInvitationGrant(engagementId, email);
    const clientId = await insertProfile(db);
    const token = randomUUID();
    tokenVerifier.registerIdToken(token, `firebase-${clientId}`, email, true);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/client-invitations/accept',
      headers: idempotencyHeaders(token),
      payload: { token: grant.token },
    });

    expect(response.statusCode).toBe(200);
    expect(asClientAccessGrant(response).state).toBe('active');

    const acceptLog = lastLogEvent('client_invitation.accept_completed');
    expect(acceptLog).toMatchObject({ engagementId });
    const serializedAcceptLog = JSON.stringify(acceptLog);
    expect(serializedAcceptLog).not.toContain(grant.token);
    expect(serializedAcceptLog).not.toContain(email);
  });

  it('logs authorization.denied (reasonCategory expired) for a lapsed invitation, never the token or the email', async () => {
    const { engagementId } = await seedEngagementWithPublisher();
    const email = 'expired-client-telemetry@example.test';
    const grant = await seedInvitationGrant(engagementId, email, {
      expiresAt: new Date('2020-01-01T00:00:00Z'),
    });
    const clientId = await insertProfile(db);
    const token = randomUUID();
    tokenVerifier.registerIdToken(token, `firebase-${clientId}`, email, true);

    const response = await app.inject({
      method: 'POST',
      url: '/v1/client-invitations/accept',
      headers: idempotencyHeaders(token),
      payload: { token: grant.token },
    });

    expect(response.statusCode).toBe(409);
    expect(asError(response).error.code).toBe('client_access_grant.expired');

    const denial = lastLogEvent('authorization.denied');
    expect(denial).toMatchObject({
      surface: 'client_invitation_accept',
      reasonCategory: 'expired',
    });
    const serializedDenial = JSON.stringify(denial);
    expect(serializedDenial).not.toContain(grant.token);
    expect(serializedDenial).not.toContain(email);
  });
});
