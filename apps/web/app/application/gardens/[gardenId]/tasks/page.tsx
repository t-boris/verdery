import { CreateManualTaskForm, TaskList } from '@/features/tasks/public';
import { getRequestTranslator } from '@/shared/localization/server';
import { RouteBody, RouteHeader, RoutePage, RoutePanel, RouteSplit } from '@/shared/ui/public';

/**
 * The garden's manual tasks: create one, and manage every one through its
 * status lifecycle.
 *
 * Source: implementation-plan.md work package P4-WEB-01;
 * packages/api-contracts/openapi.yaml, tag `Tasks`.
 */
export default async function TasksPage({
  params,
}: {
  readonly params: Promise<{ gardenId: string }>;
}) {
  const { gardenId } = await params;
  const t = await getRequestTranslator();

  return (
    <RoutePage>
      <RouteHeader title={t('tasks.pageTitle')} description={t('tasks.pageDescription')} />
      <RouteSplit>
        {/* No band heading on the list: it would repeat the route title
            verbatim ("Tasks" above "Tasks"), which the deployed page showed
            plainly. The filter panel and list are self-describing. */}
        <RouteBody>
          <RoutePanel>
            <TaskList gardenId={gardenId} />
          </RoutePanel>
        </RouteBody>
        <RouteBody>
          <RoutePanel title={t('tasks.createTitle')}>
            <CreateManualTaskForm gardenId={gardenId} />
          </RoutePanel>
        </RouteBody>
      </RouteSplit>
    </RoutePage>
  );
}
