import { AddCandidateForm, CandidateList } from '@/features/candidates/public';
import { getRequestTranslator } from '@/shared/localization/server';

import { RouteBody, RouteHeader, RoutePage, RoutePanel, RouteSplit } from '@/shared/ui/public';

import { AddCandidateFromPhotoPanel } from './add-candidate-from-photo-panel';

/**
 * The candidates entry point for a garden: browse plants under
 * consideration (searchable, filterable by status and priority), and add a
 * new one — manually, or from a photo (ADR-0015's photo-identification
 * pattern, extended to candidates).
 *
 * A candidate's own detail page (`[candidateId]/page.tsx`) is where its
 * suitability assessment is reviewed and where it is converted into a real
 * plant — kept off this list page the same way `plants/page.tsx` keeps a
 * plant's own lifecycle controls off the inventory list.
 * `AddCandidateFromPhotoPanel` lives beside this file rather than inside
 * `features/candidates` for the same reason `plants/add-plant-from-photo-
 * panel.tsx` does — see that component's own doc comment.
 *
 * Source: implementation-plan.md work package P11-WEB-01; ADR-0015;
 * packages/api-contracts/openapi.yaml, tag `PlantCandidates`.
 */
export default async function CandidatesPage({
  params,
}: {
  readonly params: Promise<{ gardenId: string }>;
}) {
  const { gardenId } = await params;
  const t = await getRequestTranslator();

  return (
    <RoutePage>
      <RouteHeader
        title={t('candidates.pageTitle')}
        description={t('candidates.pageDescription')}
      />
      <RouteSplit>
        <RouteBody>
          <RoutePanel>
            <CandidateList gardenId={gardenId} />
          </RoutePanel>
        </RouteBody>
        <RouteBody>
          <RoutePanel title={t('candidates.addTitle')}>
            <AddCandidateForm gardenId={gardenId} />
          </RoutePanel>
          <RoutePanel title={t('candidates.addFromPhotoTitle')}>
            <AddCandidateFromPhotoPanel gardenId={gardenId} />
          </RoutePanel>
        </RouteBody>
      </RouteSplit>
    </RoutePage>
  );
}
