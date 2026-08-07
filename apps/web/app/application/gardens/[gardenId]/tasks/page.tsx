import { CreateManualTaskForm, TaskList } from '@/features/tasks/public';
import { getRequestTranslator } from '@/shared/localization/server';
import {
  ActionDisclosure,
  CheckCircleIcon,
  PlusIcon,
  RouteBody,
  RouteHeader,
  RoutePage,
  RoutePanel,
} from '@/shared/ui/public';

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
      <RouteHeader
        title={t('tasks.pageTitle')}
        description={t('tasks.pageDescription')}
        icon={<CheckCircleIcon size={18} />}
      />
      <RouteBody>
        <ActionDisclosure title={t('tasks.createTitle')} icon={<PlusIcon />}>
          <CreateManualTaskForm gardenId={gardenId} />
        </ActionDisclosure>
        {/* No band heading on the list: it would repeat the route title
            verbatim ("Tasks" above "Tasks"), which the deployed page showed
            plainly. The filter panel and list are self-describing. */}
        <RoutePanel>
          <TaskList gardenId={gardenId} />
        </RoutePanel>
      </RouteBody>
    </RoutePage>
  );
}
