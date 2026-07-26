/**
 * The `collaboration.garden_assignment` lifecycle as a pure predicate,
 * paired with `garden_assignment_state_check` and
 * `garden_assignment_closure_check` (the migration) the same way
 * `client-engagement-state.ts` pairs with the engagement CHECKs: the
 * database enforces that a row is internally consistent (an `'active'`
 * assignment carries no end instant, a closed one always does), never that a
 * row's state only ever moves forward through this diagram.
 *
 *   active ──end────► ended
 *      │
 *      └──revoke────► revoked
 *
 * Both `ended` and `revoked` are terminal: an assignment that lapsed
 * naturally or was administratively pulled is not reopened — a fresh
 * assignment is a new row (see the migration's own "WHY `garden_assignment`
 * GETS NO SEPARATE PERIOD TABLE" comment).
 *
 * Source: architecture/collaboration-and-client-sharing.md, section
 * "7. Service Organizations and Assignments".
 */

export type GardenAssignmentState = 'active' | 'ended' | 'revoked';

const ALLOWED_TRANSITIONS: Readonly<
  Record<GardenAssignmentState, ReadonlySet<GardenAssignmentState>>
> = {
  active: new Set(['ended', 'revoked']),
  ended: new Set(),
  revoked: new Set(),
};

export function isValidGardenAssignmentTransition(
  from: GardenAssignmentState,
  to: GardenAssignmentState,
): boolean {
  return ALLOWED_TRANSITIONS[from].has(to);
}
