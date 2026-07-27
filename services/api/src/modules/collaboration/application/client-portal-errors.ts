/**
 * The one error constructor every P9C-API-01 read raises. Colocated the
 * same "one constructor per raised error, reused across every command that
 * raises it" shape `client-update-errors.ts` establishes, except this
 * family genuinely has only one distinct error: see
 * `ClientPortalErrorCode.NotFound`'s own header in `@verdery/api-contracts`
 * for why a second, more specific code would be a concealment bug, not an
 * improvement.
 */

import { ClientPortalErrorCode } from '@verdery/api-contracts';
import { NotFoundError } from '../../../platform/errors/application-error.js';

export function clientGardenNotFoundError(): NotFoundError {
  return new NotFoundError(ClientPortalErrorCode.NotFound, 'No client garden exists at this id.');
}
