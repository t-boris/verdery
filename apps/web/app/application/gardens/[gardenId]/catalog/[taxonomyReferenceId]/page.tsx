import Link from 'next/link';

import { TaxonProfile } from '@/features/catalog/public';
import { getRequestTranslator } from '@/shared/localization/server';

import { BookIcon, RouteBody, RouteHeader, RoutePage, RoutePanel } from '@/shared/ui/public';

/**
 * One taxon's materialized knowledge profile.
 *
 * The heading names the taxon by its identifier rather than its scientific
 * name: the name lives on `TaxonomyReference`, and no operation reads one by
 * id — only the profile does. Fetching the whole search page again to label
 * this heading would be a worse answer than letting the profile's own facts
 * carry the page.
 *
 * Source: packages/api-contracts/openapi.yaml, operation `getTaxonProfile`.
 */
export default async function TaxonProfilePage({
  params,
}: {
  readonly params: Promise<{ gardenId: string; taxonomyReferenceId: string }>;
}) {
  const { gardenId, taxonomyReferenceId } = await params;
  const t = await getRequestTranslator();

  return (
    <RoutePage>
      <RouteHeader
        title={t('catalog.profileTitle')}
        description={t('catalog.profileDescription')}
        icon={<BookIcon size={18} />}
      />
      <RouteBody>
        <RoutePanel>
          <Link href={`/application/gardens/${gardenId}/catalog`}>
            {t('catalog.backToCatalog')}
          </Link>
          <TaxonProfile taxonomyReferenceId={taxonomyReferenceId} />
        </RoutePanel>
      </RouteBody>
    </RoutePage>
  );
}
