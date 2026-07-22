/**
 * Account lifecycle state.
 *
 * Source: architecture/identity-and-authorization.md, section
 * "7. Account States".
 *
 * ```text
 * pending → active → deletion_requested → disabled → purged
 *              └──→ suspended
 * ```
 *
 * No endpoint transitions an account out of `active` yet in Phase 2 — there
 * is no suspend, deletion, or admin-support feature built. `isAccountUsable`
 * still exists now, not later, because authorization must already refuse a
 * non-active account the moment any process (a future admin tool, direct
 * support action) sets one, rather than only once the transition-triggering
 * feature ships.
 */
export type AccountState =
  'pending' | 'active' | 'suspended' | 'deletion_requested' | 'disabled' | 'purged';

export function isAccountUsable(state: AccountState): boolean {
  return state === 'active';
}
