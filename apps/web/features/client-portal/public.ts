/**
 * Public surface of the client-portal feature (P9C-WEB-01): the caller's own
 * garden switcher, accepted-garden overview, published updates, factual
 * Garden Timeline, and client-invitation acceptance. Deliberately read-only
 * throughout — no component exported here offers an edit, comment, or reply
 * affordance.
 *
 * Source: architecture/web-application-design.md, section "5. Application Structure".
 */
export { ClientAcceptInvitation } from './client-accept-invitation';
export { ClientGardenList } from './client-garden-list';
export { ClientOverview } from './client-overview';
export { ClientPublications } from './client-publications';
export { ClientTimeline } from './client-timeline';
export { useAcceptClientInvitation } from './queries';
