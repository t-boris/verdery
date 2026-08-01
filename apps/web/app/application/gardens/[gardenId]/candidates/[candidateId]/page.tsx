import Link from 'next/link';

import { CandidateDetail } from '@/features/candidates/public';
import { getRequestTranslator } from '@/shared/localization/server';

import styles from './page.module.css';

/**
 * A single candidate's detail page: its facts, suitability assessment, and
 * the commands `candidate-detail.tsx` composes against it (edit, set
 * status, convert into a real plant).
 *
 * The back link stays even though the shell's Candidates tab also leads to
 * the list — the same "explicit way out of a drill-down" reasoning
 * `plants/[plantId]/page.tsx`'s own identical back link documents.
 *
 * Source: implementation-plan.md work package P11-WEB-01.
 */
export default async function CandidateDetailPage({
  params,
}: {
  readonly params: Promise<{ gardenId: string; candidateId: string }>;
}) {
  const { gardenId, candidateId } = await params;
  const t = await getRequestTranslator();

  return (
    <div className={styles['page']}>
      <Link className={styles['back']} href={`/application/gardens/${gardenId}/candidates`}>
        {t('candidates.backToCandidates')}
      </Link>

      <CandidateDetail gardenId={gardenId} candidateId={candidateId} />
    </div>
  );
}
