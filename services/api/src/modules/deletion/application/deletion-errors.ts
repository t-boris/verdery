import { DeletionErrorCode } from '@verdery/api-contracts';
import { NotFoundError } from '../../../platform/errors/application-error.js';

/** No deletion is pending for the caller's account — `getAccountDeletion`'s and `restoreAccount`'s empty case. */
export function accountDeletionNotFoundError(): NotFoundError {
  return new NotFoundError(
    DeletionErrorCode.NotFound,
    'No deletion request is pending for this account.',
  );
}
