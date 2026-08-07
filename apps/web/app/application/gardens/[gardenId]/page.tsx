import { getRequestTranslator } from '@/shared/localization/server';

import { Collaborators } from '@/features/collaboration/public';
import { ContextQuality } from '@/features/garden-context/public';
import { GardenDangerZone, GardenSettings } from '@/features/gardens/public';
import { GardenLocationPanel } from '@/features/map/public';
import { GardenPhotoUpload, GardenPlanUpload } from '@/features/media/public';
import {
  GardenAssignmentsSection,
  GardenEngagementsSection,
} from '@/features/organizations/public';

import { HomeIcon, RouteBody, RouteHeader, RoutePage, RoutePanel } from '@/shared/ui/public';

import styles from './page.module.css';

/**
 * The garden's overview and settings. Cross-section navigation lives in the
 * application shell's garden tabs, so this page carries only its own content.
 *
 * `GardenAssignmentsSection`/`GardenEngagementsSection` (P9B-WEB-01) are
 * composed here as further SIBLINGS, the same way `GardenPhotoUpload`/
 * `GardenPlanUpload`/`Collaborators` already are — never nested inside
 * `Collaborators`, even though all four sections concern who can reach this
 * garden, because they read a genuinely different domain
 * (`collaboration.garden_assignment`/`client_engagement`, the professional-
 * service tables, not `collaboration.membership`/`invitation`) through a
 * separate feature that does not import `features/collaboration`.
 *
 * `ContextQuality` (P9D-UX-01) is composed here for the identical reason —
 * see that component's own header for why this page, rather than a new
 * route or the Seasonal plan page, is where it belongs.
 */
export default async function GardenSettingsPage({
  params,
}: {
  readonly params: Promise<{ gardenId: string }>;
}) {
  const { gardenId } = await params;
  const t = await getRequestTranslator();

  return (
    <RoutePage>
      <RouteHeader title={t('gardens.settingsTitle')} icon={<HomeIcon size={18} />} />
      <RouteBody>
        {/*
         * Ordered by how often an owner needs each one, which is not the
         * order they were built in. Archiving and deletion used to be the
         * SECOND band on the page — the two irreversible actions, above the
         * location, the plan, and everyone who works here (reported
         * 2026-08-06). They are last now.
         *
         * No band headings: every component below renders its own, and a
         * second would only repeat it.
         */}
        <div className={styles['essentials']}>
          <section className={styles['essentialPanel']}>
            <GardenSettings gardenId={gardenId} />
          </section>
          {/* First real setting: until a garden has this, its weather,
              hemisphere, seasonal plan, aerial backdrop and true north all have
              no input at all. */}
          <section className={styles['essentialPanel']}>
            <GardenLocationPanel gardenId={gardenId} />
          </section>
        </div>
        {/* Then the survey. A plan is what turns a drawing into measurements,
            so it sits above the photo gallery rather than below it. */}
        <RoutePanel>
          <GardenPlanUpload gardenId={gardenId} />
        </RoutePanel>
        <RoutePanel>
          <Collaborators gardenId={gardenId} />
        </RoutePanel>
        <RoutePanel>
          <GardenAssignmentsSection gardenId={gardenId} />
        </RoutePanel>
        <RoutePanel>
          <GardenEngagementsSection gardenId={gardenId} />
        </RoutePanel>
        <RoutePanel>
          <GardenPhotoUpload gardenId={gardenId} />
        </RoutePanel>
        <RoutePanel>
          <ContextQuality gardenId={gardenId} />
        </RoutePanel>
        <RoutePanel>
          <GardenDangerZone gardenId={gardenId} />
        </RoutePanel>
      </RouteBody>
    </RoutePage>
  );
}
