import { getRequestTranslator } from '@/shared/localization/server';

import { CreateOrganizationForm, OrganizationList } from '@/features/organizations/public';
import {
  ActionDisclosure,
  BuildingIcon,
  PlusIcon,
  RouteBody,
  RouteDashboard,
  RouteHeader,
  RoutePage,
  RoutePanel,
} from '@/shared/ui/public';

/**
 * The professional workspace's own root route: every service organization
 * the signed-in profile belongs to, and a form to create a new one.
 *
 * A vertical slice mirroring `app/application/gardens/page.tsx` exactly
 * (list + create) — the professional-service domain's own root, distinct
 * from the garden-scoped tab bar, since organization membership is not
 * garden-scoped at all. It follows that page onto the shared route chrome
 * for the same reason: two roots of the same application should not be two
 * layouts.
 *
 * Source: implementation-plan.md work package P9B-WEB-01;
 * packages/api-contracts/openapi.yaml, tag `Organizations`.
 */
export default async function OrganizationsPage() {
  const t = await getRequestTranslator();

  return (
    <RoutePage>
      <RouteHeader
        title={t('organizations.title')}
        description={t('organizations.description')}
        icon={<BuildingIcon size={18} />}
      />
      <RouteBody>
        <RouteDashboard>
          <RoutePanel>
            <OrganizationList />
          </RoutePanel>
          <ActionDisclosure title={t('organizations.createTitle')} icon={<PlusIcon />}>
            <CreateOrganizationForm />
          </ActionDisclosure>
        </RouteDashboard>
      </RouteBody>
    </RoutePage>
  );
}
