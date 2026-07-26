/**
 * `RunInvitationExpirySweep` (P9A-API-01): the periodic bulk pass that
 * transitions past-expiry `pending` invitations to `expired`, matching the
 * established sweep shape (`run-notification-delivery-sweep.ts`,
 * `run-recommendation-evaluation-sweep.ts`) — a scheduled pass rather than a
 * per-request check.
 *
 * WHY A SWEEP AND NOT A PER-REQUEST CHECK: nothing outside acceptance itself
 * ever reads a single invitation's state on a schedule a user controls —
 * `AcceptInvitation` already self-heals the ONE row it happens to touch
 * (see that file's "LAZY EXPIRY" section), so a per-request check would only
 * ever correct rows someone tries to accept. Every other row — abandoned
 * invitations nobody ever attempts to use — would carry a `state` its own
 * `expires_at` has quietly stopped agreeing with, forever. A roster or audit
 * read that trusts `state = 'pending'` at face value would misreport an
 * invitation as still live. The sweep is what keeps the STORED state honest
 * for every row, not only the ones a client happens to touch.
 *
 * WHY THIS IS NOT AUDITED PER ROW: the P9A-DATA-01 migration's own
 * enumeration of what must reach `platform.audit_event` — "every membership
 * grant, role change, removal, invitation issue/revoke/accept" — deliberately
 * does not include expiry. Expiry is time passing, not an actor's decision;
 * nothing here is `actorType: 'user'`. The sweep's own summary (returned to
 * its internal-route caller, exactly like every sibling sweep) is the
 * record of how many rows a run closed.
 *
 * WHY NO TRANSACTION WRAPPER: every sibling sweep's `unitOfWork.run(...)`
 * exists to bind MULTIPLE ports to one transaction (claim, then per-intent
 * writes across `delivery`/`devices`). This sweep does exactly one
 * statement against exactly one table, which Postgres already runs
 * atomically on its own — wrapping it would add ceremony with no additional
 * guarantee.
 *
 * Source: implementation-plan.md work package P9A-API-01.
 */

import type { Clock } from '../../../shared/time/clock.js';
import type { InvitationRepository } from './invitation-repository.js';

/** Rows closed per run. A bulk state flip, not a fan-out (no provider calls, no per-row branching) — far cheaper than the delivery sweep's claim, so the bound is wide, matching that sweep's own `DELIVERY_SWEEP_EXPIRY_LIMIT` reasoning. */
export const INVITATION_EXPIRY_SWEEP_LIMIT = 500;

export interface InvitationExpirySweepResult {
  readonly invitationsExpired: number;
}

export class RunInvitationExpirySweep {
  constructor(
    private readonly invitations: InvitationRepository,
    private readonly clock: Clock,
  ) {}

  async execute(): Promise<InvitationExpirySweepResult> {
    const invitationsExpired = await this.invitations.expireDuePending(
      this.clock.now(),
      INVITATION_EXPIRY_SWEEP_LIMIT,
    );

    return { invitationsExpired };
  }
}
