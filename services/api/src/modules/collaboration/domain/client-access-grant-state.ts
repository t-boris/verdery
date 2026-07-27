/**
 * The `client_access_grant` state machine, as a pure predicate — the same
 * shape `client-engagement-state.ts` already establishes for its own table.
 *
 * ```text
 * pending ──accept──► active ──revoke──► revoked
 *    │
 *    ├──revoke───────────────────────────► revoked
 *    └──time─────────────────────────────► expired
 * ```
 *
 * ONE EDGE `collaboration.invitation`'s own `InvitationState` machine does
 * NOT have: `active -> revoked`. An operational invitation only ever revokes
 * a still-`pending` row — once accepted, ending access is a wholly separate
 * mechanism (`removeGardenMember`) against a wholly separate table
 * (`collaboration.membership`). `client_access_grant` has no such second
 * table: this ONE row is both the invitation and the client's ongoing
 * portal-access grant, so "revoke a pending invite" and "revoke an active
 * client's access" are necessarily the same transition on the same row
 * (architecture/collaboration-and-client-sharing.md, section "9. Client
 * Invitation and Session": "Revoke — the same authorized-professional
 * capability revokes a pending OR active grant").
 *
 * `collaboration.client_access_grant_state_check` (the migration) constrains
 * only the four admitted VALUES; it cannot see a row's PREVIOUS state, so it
 * cannot stop an illegal transition — the identical limitation
 * `client-engagement-state.ts`'s own header documents at length for its own
 * table. This function is where the sequencing rule actually lives, called
 * by `AcceptClientInvitation`/`RevokeClientInvitation` before writing a new
 * state.
 *
 * Source: architecture/collaboration-and-client-sharing.md, section
 * "9. Client Invitation and Session";
 * migrations/1786900000000_client-invitation-token.sql.
 */

export type ClientAccessGrantState = 'pending' | 'active' | 'revoked' | 'expired';

const ALLOWED_TRANSITIONS: Readonly<
  Record<ClientAccessGrantState, ReadonlySet<ClientAccessGrantState>>
> = {
  pending: new Set(['active', 'revoked', 'expired']),
  active: new Set(['revoked']),
  // Both terminal: nothing in the diagram leaves 'revoked' or 'expired'.
  revoked: new Set(),
  expired: new Set(),
};

export function isValidClientAccessGrantTransition(
  from: ClientAccessGrantState,
  to: ClientAccessGrantState,
): boolean {
  return ALLOWED_TRANSITIONS[from].has(to);
}
