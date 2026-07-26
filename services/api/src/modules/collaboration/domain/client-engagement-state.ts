/**
 * The client-engagement state machine, as a pure predicate over the diagram
 * collaboration-and-client-sharing.md section 8 already draws:
 *
 *   draft ──activate──► active ──end──► ended
 *     │                    │
 *     └──cancel────────────┴─────────► revoked
 *
 * `collaboration.client_engagement_state_check` (the migration) constrains
 * the four values a row may hold; it CANNOT constrain the sequence a row may
 * move through them in, because a `CHECK` sees only the row being written,
 * never what it used to be — the same limitation the last-owner invariant
 * has, and just as honestly documented in the migration's own header. THIS
 * function is where the sequencing rule actually lives: whichever command
 * layer manages engagement transitions (P9C-PUBLISH-01, per the work-package
 * table) calls it before writing a new state, and the migration test suite
 * separately proves the database accepts a transition this function would
 * reject — the same "does NOT stop it, and here is what must" pairing
 * `collaboration-assignment-and-last-owner.test.ts` already established for
 * demoting a last owner.
 *
 * Source: architecture/collaboration-and-client-sharing.md, section
 * "8. Client Engagement".
 */

export type ClientEngagementState = 'draft' | 'active' | 'ended' | 'revoked';

const ALLOWED_TRANSITIONS: Readonly<
  Record<ClientEngagementState, ReadonlySet<ClientEngagementState>>
> = {
  draft: new Set(['active', 'revoked']),
  active: new Set(['ended', 'revoked']),
  // Both terminal: nothing in the diagram leaves 'ended' or 'revoked'.
  ended: new Set(),
  revoked: new Set(),
};

export function isValidClientEngagementTransition(
  from: ClientEngagementState,
  to: ClientEngagementState,
): boolean {
  return ALLOWED_TRANSITIONS[from].has(to);
}
