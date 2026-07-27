/**
 * Composes the ONE transactional email `CreateClientInvitation` sends —
 * kept separate from `transactional-email-provider.ts` (the generic port)
 * for the reason that file's own header gives: composing WHAT a client-
 * invitation email says is this module's business content, not the
 * provider's concern.
 *
 * NO SENSITIVE GARDEN CONTENT, matching architecture/collaboration-and-
 * client-sharing.md section 9's own step 2 exactly: "Transactional email
 * delivers an opaque, expiring link WITHOUT sensitive garden content." No
 * garden name, address, service-organization name, or engagement detail
 * appears anywhere in this message — only the accept link and its own
 * expiry instant.
 */

import type { TransactionalEmailMessage } from '../../integrations/public.js';

const SUBJECT = 'You have been invited to view your garden updates';

/** Builds the one-time accept link the email carries. `baseUrl` is server-configured (`CLIENT_PORTAL_BASE_URL`), never a client-supplied value — the web client route this points at (`/client/accept-invitation`) is P9C-WEB-01's own, not yet built; this backend package only needs the URL SHAPE to exist. */
export function buildClientInvitationAcceptUrl(baseUrl: string, token: string): string {
  const url = new URL('/client/accept-invitation', baseUrl);
  url.searchParams.set('token', token);
  return url.toString();
}

export function buildClientInvitationEmailMessage(
  to: string,
  acceptUrl: string,
  expiresAt: Date,
): TransactionalEmailMessage {
  const expiresLabel = expiresAt.toISOString();

  return {
    to,
    subject: SUBJECT,
    text:
      'You have been invited to a client garden portal.\n\n' +
      `Open this link to sign in and get started: ${acceptUrl}\n\n` +
      `This link expires on ${expiresLabel} and can only be used once.\n\n` +
      'If you were not expecting this invitation, you can ignore this email.',
    html:
      '<p>You have been invited to a client garden portal.</p>' +
      `<p><a href="${acceptUrl}">Open your invitation</a></p>` +
      `<p>This link expires on ${expiresLabel} and can only be used once.</p>` +
      '<p>If you were not expecting this invitation, you can ignore this email.</p>',
  };
}
