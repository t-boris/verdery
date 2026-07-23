import Link from 'next/link';

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
      <Link className={styles['back']} href={`/application/gardens/${gardenId}`}>
        {t('map.page.backToSettings')}
      </Link>
      <div>
        <h1 className={styles['title']}>{t('tasks.pageTitle')}</h1>
        <p className={styles['description']}>{t('tasks.pageDescription')}</p>
      </div>

      <div>
        <h2 className={styles['sectionTitle']}>{t('tasks.createTitle')}</h2>
        <CreateManualTaskForm gardenId={gardenId} />
      </div>

      <div>
        <h2 className={styles['sectionTitle']}>{t('tasks.listTitle')}</h2>
        <TaskList gardenId={gardenId} />
      </div>
    </div>
  );
}
