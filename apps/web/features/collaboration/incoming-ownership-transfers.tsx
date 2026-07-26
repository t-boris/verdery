'use client';

import type { IncomingOwnershipTransfer } from '@verdery/api-contracts';
import { CollaborationErrorCode } from '@verdery/api-contracts';
import { useState } from 'react';

import { useLocalization } from '@/shared/localization/public';
import { Button, Card, FailureAlert } from '@/shared/ui/public';

import styles from './incoming-ownership-transfers.module.css';
import {
  useAcceptOwnershipTransfer,
  useDeclineOwnershipTransfer,
  useIncomingOwnershipTransfers,
} from './ownership-queries';

type CardNotice = 'accepted' | 'declined' | 'gone' | null;

/** A failure whose code is `OwnershipTransferNotFound` is never worth its own `FailureAlert` — see `onAccept`/`onDecline` below. */
function isNotFoundFailure(failure: { readonly code: string }): boolean {
  return failure.code === CollaborationErrorCode.OwnershipTransferNotFound;
}

/**
 * One pending transfer addressed to the caller, named by its destination
 * garden. `accept`/`decline` reuse the exact same per-garden mutation hooks
 * `ownership-transfer-panel.tsx`'s `RecipientTransferSection` calls — both
 * ultimately hit the identical `/gardens/{gardenId}/ownership-transfer
 * /accept|decline` endpoints, keyed by the `gardenId` this item already
 * carries. What is NOT shared is the surrounding confirm/notice wiring: this
 * card's "resolved" state has no follow-up action to show (unlike the
 * per-garden panel, it never transitions to a request form), and its title
 * is the destination garden's name rather than a fixed heading, so folding
 * the two into one shared component would need as many override props as it
 * would save lines. See `incoming-ownership-transfers.tsx`'s own module
 * comment for the fuller reasoning.
 */
function IncomingOwnershipTransferCard({
  transfer,
}: {
  readonly transfer: IncomingOwnershipTransfer;
}) {
  const { t } = useLocalization();
  const [notice, setNotice] = useState<CardNotice>(null);

  const acceptMutation = useAcceptOwnershipTransfer(transfer.gardenId);
  const declineMutation = useDeclineOwnershipTransfer(transfer.gardenId);

  const onAccept = () => {
    if (!globalThis.confirm(t('ownership.acceptConfirm'))) {
      return;
    }
    acceptMutation.mutate(undefined, {
      onSuccess: () => setNotice('accepted'),
      onError: (error) => {
        if (isNotFoundFailure(error.failure)) {
          setNotice('gone');
        }
      },
    });
  };

  const onDecline = () => {
    declineMutation.mutate(undefined, {
      onSuccess: () => setNotice('declined'),
      onError: (error) => {
        if (isNotFoundFailure(error.failure)) {
          setNotice('gone');
        }
      },
    });
  };

  if (notice !== null) {
    return (
      <Card title={transfer.gardenName}>
        <p role="status">
          {t(
            notice === 'accepted'
              ? 'ownership.acceptedNotice'
              : notice === 'declined'
                ? 'ownership.declinedNotice'
                : 'ownership.noneForYou',
          )}
        </p>
      </Card>
    );
  }

  return (
    <Card title={transfer.gardenName}>
      <p className={styles['description']}>
        {t('ownership.respondDescription', { fromProfileId: transfer.fromProfileId })}
      </p>
      <div className={styles['actions']}>
        <Button variant="primary" busy={acceptMutation.isPending} onClick={onAccept}>
          {t('ownership.accept')}
        </Button>
        <Button variant="secondary" busy={declineMutation.isPending} onClick={onDecline}>
          {t('ownership.decline')}
        </Button>
      </div>
      {acceptMutation.isError && !isNotFoundFailure(acceptMutation.error.failure) && (
        <FailureAlert failure={acceptMutation.error.failure} />
      )}
      {declineMutation.isError && !isNotFoundFailure(declineMutation.error.failure) && (
        <FailureAlert failure={declineMutation.error.failure} />
      )}
    </Card>
  );
}

/**
 * The recipient-discoverability gap `ownership-transfer-panel.tsx` used to
 * document as unbuildable: before P9A-OWNER-02's
 * `GET /ownership-transfers/incoming`, a recipient had no way to learn a
 * transfer named them without being told out of band by the initiator. This
 * renders one card per pending transfer addressed to the caller, across
 * EVERY garden — not only the one currently open — each carrying its
 * destination garden's own name so "accept ownership of Riverside Garden?"
 * is answerable without leaving the gardens list.
 *
 * Composed into `app/application/gardens/page.tsx` as a sibling of
 * `GardenList`, the same way `Collaborators` sits beside `GardenSettings` at
 * the per-garden page level — a cross-feature composition the app router
 * page performs, not a dependency either feature takes on the other.
 *
 * Renders nothing while loading, on a failed first load, or once loaded with
 * an empty list — this is a secondary, easy-to-miss-by-design banner, not
 * the page's primary content, so it stays silent rather than adding its own
 * loading or error chrome on top of the gardens list's. A stale list from a
 * failed background refetch is left visible rather than replaced, per
 * architecture doc section "9. Online-First Behavior" — an offer that was
 * true a moment ago is still worth showing.
 *
 * Source: implementation-plan.md work package P9A-OWNER-02;
 * packages/api-contracts/openapi.yaml, operation `listIncomingOwnershipTransfers`.
 */
export function IncomingOwnershipTransfers() {
  const { t } = useLocalization();
  const query = useIncomingOwnershipTransfers();

  if (query.data === undefined || query.data.items.length === 0) {
    return null;
  }

  return (
    <section className={styles['section']}>
      <h2 className={styles['heading']}>{t('ownership.incomingListTitle')}</h2>
      <ul className={styles['list']}>
        {query.data.items.map((transfer) => (
          <li key={transfer.id}>
            <IncomingOwnershipTransferCard transfer={transfer} />
          </li>
        ))}
      </ul>
    </section>
  );
}
