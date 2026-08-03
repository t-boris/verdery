import { TaxonSearch } from '@/features/catalog/public';
import { getRequestTranslator } from '@/shared/localization/server';

import { RouteBody, RouteHeader, RoutePage, RoutePanel } from '@/shared/ui/public';

/**
 * Browsing the shared plant catalog from inside a garden.
 *
 * Garden-scoped in its route but not in its data: the catalog is shared
 * reference knowledge, and the `gardenId` here only decides which taxonomy
 * references the name search may resolve against — the same scoping
 * `searchTaxonomyReferences` already has. It sits under the garden because
 * that is where a reader is when they wonder what a plant needs.
 *
 * Source: implementation-plan.md work package P11-WEB-01;
 * packages/api-contracts/openapi.yaml, tag `PlantCatalog`.
 */
export default async function CatalogPage({
  params,
}: {
  readonly params: Promise<{ gardenId: string }>;
}) {
  const { gardenId } = await params;
  const t = await getRequestTranslator();

  return (
    <RoutePage>
      <RouteHeader title={t('catalog.pageTitle')} description={t('catalog.pageDescription')} />
      <RouteBody>
        <RoutePanel>
          <TaxonSearch gardenId={gardenId} />
        </RoutePanel>
      </RouteBody>
    </RoutePage>
  );
}
