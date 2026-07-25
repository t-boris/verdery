import { CreateManualTaskForm, TaskList } from '@/features/tasks/public';
import { getRequestTranslator } from '@/shared/localization/server';

import styles from './page.module.css';

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
    <div className={styles['page']}>
      <div className={styles['header']}>
        <h1 className={styles['title']}>{t('tasks.pageTitle')}</h1>
        <p className={styles['description']}>{t('tasks.pageDescription')}</p>
      </div>

      {/* No section heading: it would repeat the page title verbatim
          ("Tasks" above "Tasks"), which the deployed page showed plainly.
          The filter panel and list are self-describing. */}
      <div className={styles['section']}>
        <TaskList gardenId={gardenId} />
      </div>

      <section className={styles['panel']}>
        <h2 className={styles['sectionTitle']}>{t('tasks.createTitle')}</h2>
        <CreateManualTaskForm gardenId={gardenId} />
      </section>
    </div>
  );
}
