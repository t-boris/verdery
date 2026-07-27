/**
 * Issues an email-bound, expiring client invitation (P9C-INVITE-01) — step 1
 * of architecture/collaboration-and-client-sharing.md section 9's six-step
 * flow: "An authorized professional creates an email-bound invitation for an
 * engagement." Step 2, "Transactional email delivers an opaque, expiring
 * link without sensitive garden content," happens synchronously inside this
 * SAME command — see this file's own "SYNCHRONOUS, NOT WORKER-ROUTED"
 * section for why.
 *
 * AUTHORIZATION: `requireEngagementCapability` — the SAME dual gate
 * `ActivateClientEngagement`/`GrantPublisherAccess` already apply
 * (`manageEngagement` for an organization-backed engagement,
 * `manageGarden` otherwise), reused UNCHANGED rather than a new grant table.
 * ADR-0012's "Publication Boundary" section explicitly calls publisher
 * access out as "a SEPARATE capability" from engagement administration —
 * deciding WHO THE CLIENT IS has no equivalent sentence anywhere in the
 * architecture. Section 8 treats "one client identity or pending bound
 * invitation" as a precondition of the ENGAGEMENT's OWN activation, the same
 * administrative register as "at least one garden" — not a distinct
 * workflow capability an org admin might withhold from themselves the way
 * publishing is withheld from every professional by default. Riding on
 * `requireEngagementCapability` is therefore the architecture's own silence
 * read the same way `RevokeClientEngagement`'s identical reuse already
 * reads it, not an oversight of the publisher precedent.
 *
 * SYNCHRONOUS, NOT WORKER-ROUTED. Section 17 describes the general
 * notification-worker model: "Workers recheck recipient access, current
 * state, preferences, deduplication key, and freshness before delivery."
 * That model assumes a RECIPIENT PROFILE to recheck access/preferences
 * against — `notifications.notification_intent.recipient_profile_id` is
 * `NOT NULL` (`1786000000000_notifications-baseline.sql`). An invited
 * client, by construction, has none yet: this invitation IS how they first
 * become reachable at all. Routing the FIRST email through that pipeline is
 * therefore not merely undesirable, it is structurally impossible without a
 * schema change this package does not own. The invitation link is also the
 * very first client-facing event, not a "check back later" notice — so this
 * command sends it itself, synchronously, and reports failure honestly
 * rather than queuing a promise nothing can yet fulfil.
 *
 * ORDERING: THE EMAIL SENDS BEFORE ANY ROW IS WRITTEN. Deliberately the
 * OPPOSITE of `RefreshGardenWeather`'s "call the provider, then write"
 * shape used for a READ-refresh — here it additionally avoids a subtler
 * correctness trap: if the grant row (and its `Idempotency-Key` record) were
 * committed FIRST and email sending failed SECOND, a retry under the SAME
 * key would replay the cached SUCCESS response from
 * `platform.idempotency_record` forever within its TTL — since
 * `context.idempotency.save` only ever runs inside a transaction that already
 * committed — silently claiming success for an invitation whose only copy of
 * its own raw token no longer exists anywhere (this command never returns or
 * stores it; see this file's own "THE RAW TOKEN NEVER LEAVES THIS COMMAND").
 * Calling the email adapter BEFORE opening any transaction means a failed
 * send leaves NOTHING written — no dangling row, no poisoned idempotency
 * cache, and a caller can simply retry the identical request. The accepted
 * trade-off runs the other way instead: on the rare failure of the
 * transaction itself AFTER a successful send (a genuine concurrent race, or
 * a database outage), a client may receive a real email whose token never
 * ends up persisted — that link 404s harmlessly at accept time
 * (`client_access_grant.not_found`, concealed exactly like an operational
 * invitation's own unknown token), and the caller's retry simply issues a
 * fresh invitation. A materially rarer, and far less confusing, failure mode
 * than a permanently un-resendable "successful" invitation.
 *
 * THE RAW TOKEN NEVER LEAVES THIS COMMAND — a genuine difference from the
 * operational `CreateInvitation`, which must return its raw token in the
 * HTTP response because no delivery mechanism exists for it yet. Here one
 * does: the token is generated, hashed for storage, embedded in the accept
 * link the email carries, and then discarded. `CreateClientInvitationResult`
 * (the API response) is a bare `ClientAccessGrant` with no token field at
 * all — never logged, and now never returned either.
 *
 * ELIGIBLE ENGAGEMENT STATES: `draft` OR `active`. Section 8: "Activation
 * requires at least one garden, one client identity OR PENDING BOUND
 * INVITATION" — a pending invitation must be creatable BEFORE activation to
 * satisfy that precondition at all, so `draft` is deliberately included, not
 * only `active`. `ended`/`revoked` are refused: "An ended or revoked
 * engagement cannot authorize new portal or media access" (section 8).
 *
 * Source: implementation-plan.md work package P9C-INVITE-01;
 * architecture/collaboration-and-client-sharing.md, sections
 * "9. Client Invitation and Session", "8. Client Engagement", "17.
 * Notifications"; architecture/external-integrations.md, section
 * "10. Transactional Messaging".
 */

import { ClientAccessGrantErrorCode, SharedErrorCode } from '@verdery/api-contracts';
import type { ClientAccessGrant as ClientAccessGrantResource } from '@verdery/api-contracts';
import {
  isUniqueViolation,
  postgresConstraintName,
} from '../../../platform/database/postgres-errors.js';
import {
  ConflictError,
  DependencyUnavailableError,
  DomainRuleViolatedError,
} from '../../../platform/errors/application-error.js';
import type { IdempotencyStore } from '../../../platform/idempotency/idempotency-store.js';
import { withDeadline } from '../../integrations/public.js';
import type { TransactionalEmailAdapter } from '../../integrations/public.js';
import { generateUuidV7 } from '../../../shared/identifiers/uuid.js';
import type { Uuid } from '../../../shared/identifiers/uuid.js';
import type { Clock } from '../../../shared/time/clock.js';
import type { GardenAuthorization } from '../../gardens-mapping/public.js';
import {
  buildClientInvitationAcceptUrl,
  buildClientInvitationEmailMessage,
} from './client-invitation-email-content.js';
import {
  createClientAccessGrantInvitation,
  normalizeInvitedEmail,
} from '../domain/client-access-grant.js';
import type { ClientAccessGrantRepository } from './client-access-grant-repository.js';
import type { ClientEngagementRepository } from './client-engagement-repository.js';
import { engagementNotFoundError } from './client-update-errors.js';
import {
  generateClientInvitationToken,
  hashClientInvitationToken,
} from './client-invitation-token.js';
import type { CollaborationUnitOfWork } from './collaboration-unit-of-work.js';
import type { OrganizationAuthorization } from './organization-authorization.js';
import { requireEngagementCapability } from './require-engagement-capability.js';
import { IDEMPOTENCY_TTL_MILLISECONDS } from './run-idempotent-command.js';
import { toClientAccessGrantResource } from './client-access-grant-view.js';

const OPERATION = 'client_engagements.client_invitations.create';
const PENDING_EMAIL_CONSTRAINT = 'client_access_grant_pending_email_key';

/** Default lifetime for a client invitation — the same fixed-constant honesty `INVITATION_TTL_MILLISECONDS` documents for the operational invitation: no document names a specific number. A week matches that same lowest-friction default. */
export const CLIENT_INVITATION_TTL_MILLISECONDS = 7 * 24 * 60 * 60 * 1000;

export interface ClientInvitationEmailConfiguration {
  /** `null` whenever `RESEND_API_KEY` is unconfigured — the honest `AiExplanationProviderAdapter | null` posture, reused here. */
  readonly adapter: TransactionalEmailAdapter | null;
  /** Present whenever `adapter` is — the base origin the accept link is built against (`CLIENT_PORTAL_BASE_URL`). */
  readonly clientPortalBaseUrl: string | null;
  readonly callTimeoutMs: number;
}

function alreadyOutstanding(cause?: unknown): ConflictError {
  return new ConflictError(
    ClientAccessGrantErrorCode.AlreadyOutstanding,
    'An outstanding invitation or active access grant already exists for this email on this engagement.',
    cause === undefined ? {} : { cause },
  );
}

export class CreateClientInvitation {
  constructor(
    private readonly idempotency: IdempotencyStore,
    private readonly unitOfWork: CollaborationUnitOfWork,
    private readonly organizationAuthorization: OrganizationAuthorization,
    private readonly gardenAuthorization: GardenAuthorization,
    private readonly engagements: ClientEngagementRepository,
    /**
     * A plain, non-transactional reader — the identical "second independent
     * reader over the same pool" posture `CreateGardenAssignment`'s own
     * `GardenRepository` dependency takes (see `collaboration-unit-of-work
     * .ts`'s own header, "NO gardens REPOSITORY BOUND HERE"), used ONLY for
     * the pre-check that must complete BEFORE the email send below; the
     * actual write goes through `unitOfWork`'s transaction-bound repository
     * like every other command's.
     */
    private readonly clientAccessGrants: ClientAccessGrantRepository,
    private readonly email: ClientInvitationEmailConfiguration,
    private readonly clock: Clock,
  ) {}

  async execute(
    engagementId: Uuid,
    rawEmail: string,
    actorProfileId: Uuid,
    idempotencyKey: string,
  ): Promise<ClientAccessGrantResource> {
    const engagement = await this.engagements.findById(engagementId);
    if (engagement === null) {
      throw engagementNotFoundError();
    }

    await requireEngagementCapability(
      engagement,
      actorProfileId,
      this.organizationAuthorization,
      this.gardenAuthorization,
    );

    if (engagement.state !== 'draft' && engagement.state !== 'active') {
      throw new DomainRuleViolatedError(
        ClientAccessGrantErrorCode.EngagementNotInvitable,
        `Cannot invite a client on an engagement in state "${engagement.state}".`,
      );
    }

    const invitedEmail = normalizeInvitedEmail(rawEmail);

    const input = {
      actorProfileId,
      operation: OPERATION,
      idempotencyKey,
      requestFingerprint: JSON.stringify({ engagementId, invitedEmail }),
    };

    const check = await this.idempotency.check(input);
    if (check.kind === 'replay') {
      return check.responseBody as ClientAccessGrantResource;
    }

    const alreadyExists = await this.clientAccessGrants.hasOutstandingGrantForEmail(
      engagementId,
      invitedEmail,
    );
    if (alreadyExists) {
      throw alreadyOutstanding();
    }

    if (this.email.adapter === null || this.email.clientPortalBaseUrl === null) {
      throw new DependencyUnavailableError(
        SharedErrorCode.DependencyUnavailable,
        'No transactional email provider is configured for client invitations.',
      );
    }

    const now = this.clock.now();
    const rawToken = generateClientInvitationToken();
    const tokenHash = hashClientInvitationToken(rawToken);
    const expiresAt = new Date(now.getTime() + CLIENT_INVITATION_TTL_MILLISECONDS);
    const acceptUrl = buildClientInvitationAcceptUrl(this.email.clientPortalBaseUrl, rawToken);
    const message = buildClientInvitationEmailMessage(invitedEmail, acceptUrl, expiresAt);

    // The external call, OUTSIDE any transaction — see this file's own
    // header, "ORDERING". A rejection here (transport failure, non-2xx, a
    // timed-out deadline) leaves nothing written.
    try {
      const outcome = await withDeadline(this.email.callTimeoutMs, (signal) =>
        (this.email.adapter as TransactionalEmailAdapter).send(message, signal),
      );
      if (outcome.kind === 'timedOut') {
        throw new DependencyUnavailableError(
          SharedErrorCode.DependencyUnavailable,
          'The transactional email provider did not respond in time.',
        );
      }
    } catch (error) {
      if (error instanceof DependencyUnavailableError) {
        throw error;
      }
      throw new DependencyUnavailableError(
        SharedErrorCode.DependencyUnavailable,
        'The invitation email could not be sent.',
        { cause: error },
      );
    }

    try {
      return await this.unitOfWork.run(async (context) => {
        const grant = createClientAccessGrantInvitation({
          id: generateUuidV7(),
          engagementId,
          invitedEmail,
          tokenHash,
          now,
          expiresAt,
        });

        try {
          await context.clientAccessGrants.insert(grant);
        } catch (error) {
          if (
            isUniqueViolation(error) &&
            postgresConstraintName(error) === PENDING_EMAIL_CONSTRAINT
          ) {
            throw alreadyOutstanding(error);
          }
          throw error;
        }

        await context.auditLogger.record({
          eventType: 'client_access_grant.invited',
          subjectType: 'client_access_grant',
          subjectId: grant.id,
          actorProfileId,
          actorType: 'user',
          gardenId: engagement.gardenId,
          details: { engagementId },
        });
        // Audit/observability parity with every other collaboration command
        // (`invitation.issued`, `publisher_grant.granted`) — an ordinary
        // ad hoc outbox event, not a formal cross-process contract like
        // `client_update.published`'s: nothing outside this module ever
        // consumes it (the delivery it announces already happened,
        // synchronously, above).
        await context.outbox.append({
          eventType: 'client_access_grant.invited',
          aggregateType: 'client_access_grant',
          aggregateId: grant.id,
          payload: { engagementId, gardenId: engagement.gardenId },
        });

        const resource = toClientAccessGrantResource(grant);
        await context.idempotency.save(input, 201, resource, IDEMPOTENCY_TTL_MILLISECONDS);
        return resource;
      });
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const recheck = await this.idempotency.check(input);
      if (recheck.kind === 'replay') {
        return recheck.responseBody as ClientAccessGrantResource;
      }
      throw error;
    }
  }
}
