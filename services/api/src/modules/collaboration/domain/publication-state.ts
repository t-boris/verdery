/**
 * The `client_update` publication state machine, as a pure predicate over the
 * diagram collaboration-and-client-sharing.md section 10 and ADR-0012's own
 * "Publication Boundary" both draw:
 *
 *   internal_draft ──submit──► ready_for_client ──publish──► published ──withdraw──► withdrawn
 *
 * Strictly linear, unlike `client-engagement-state.ts`'s own diamond (a
 * `client_engagement` can reach `revoked` from either `draft` or `active`):
 * nothing here reaches `withdrawn` except from `published`, and nothing
 * skips a step in either direction.
 *
 * `collaboration.client_update_state_check` (the migration) constrains the
 * four values a row may hold, plus the linkage CHECKs that keep a row
 * internally consistent for whichever state it claims (a summary is
 * required from `ready_for_client` onward, `withdrawn_at` only ever
 * accompanies `state = 'withdrawn'`, and so on). None of that can constrain
 * the SEQUENCE a row moves through its states in — a `CHECK` sees only the
 * row being written, never what it used to be, the same limitation the
 * last-owner invariant and `client_engagement`'s own sequencing gap already
 * document honestly in their own migrations. THIS function is where the
 * sequencing rule actually lives: whichever command layer manages
 * publication transitions (P9C-PUBLISH-01, per the work-package table)
 * calls it before writing a new state, and
 * `tests/migrations/publication-state.test.ts` separately proves the
 * database accepts a transition this function would reject.
 *
 * Source: architecture/collaboration-and-client-sharing.md, section
 * "10. Publication Workflow";
 * architecture/decisions/ADR-0012-separate-team-and-client-sharing.md,
 * section "Publication Boundary".
 */

export type PublicationState = 'internal_draft' | 'ready_for_client' | 'published' | 'withdrawn';

const ALLOWED_TRANSITIONS: Readonly<Record<PublicationState, ReadonlySet<PublicationState>>> = {
  internal_draft: new Set(['ready_for_client']),
  ready_for_client: new Set(['published']),
  published: new Set(['withdrawn']),
  // Terminal: nothing in the diagram leaves 'withdrawn'.
  withdrawn: new Set(),
};

export function isValidPublicationTransition(
  from: PublicationState,
  to: PublicationState,
): boolean {
  return ALLOWED_TRANSITIONS[from].has(to);
}
