'use client';

import { useId, useState, type ReactNode } from 'react';

import { useLocalization } from '@/shared/localization/public';
import { Button, ChevronDownIcon, classNames } from '@/shared/ui/public';
import type { MessageKey } from '@/shared/localization/public';

import styles from './map-inspector-drawer.module.css';

export type InspectorTabId = 'properties' | 'objects' | 'backdrop' | 'warnings';

export interface InspectorTab {
  readonly id: InspectorTabId;
  readonly labelKey: MessageKey;
  /** Rendered on the tab when it has something to report — the warning count. */
  readonly badge?: number;
  readonly content: ReactNode;
}

export interface MapInspectorDrawerProps {
  readonly tabs: readonly InspectorTab[];
  /**
   * Which tab to show. The editor decides: selecting an object opens
   * Properties, because that is what the person just asked a question about.
   */
  readonly activeTab: InspectorTabId;
  readonly onSelectTab: (tab: InspectorTabId) => void;
}

/**
 * One drawer beside the canvas, in place of five stacked panels.
 *
 * The editor used to spend a whole column on an object index and another on an
 * inspector that scrolled through properties, backdrop, layers, imported
 * background, calibration and warnings in a single run — four regions of
 * controls at once, and a canvas squeezed into what was left. Everything that
 * is not the drawing now lives either on the canvas as floating chrome or
 * here, one thing at a time.
 *
 * Collapsible, because a person tracing a lot wants the whole window for it;
 * the collapsed state keeps the tab strip, so nothing becomes unreachable.
 *
 * Source: architecture/web-application-design.md, section "5. Application
 * Structure"; architecture/map-rendering-and-editing.md, section "13. Web
 * Rendering".
 */
export function MapInspectorDrawer({ tabs, activeTab, onSelectTab }: MapInspectorDrawerProps) {
  const { t } = useLocalization();
  const [expanded, setExpanded] = useState(true);
  const panelId = useId();
  const active = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];

  return (
    <aside
      className={classNames(styles['drawer'], !expanded && styles['drawerCollapsed'])}
      aria-label={t('map.inspector.ariaLabel')}
    >
      <div className={styles['header']}>
        <div className={styles['tabs']} role="tablist" aria-label={t('map.inspector.ariaLabel')}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`${panelId}-${tab.id}`}
              aria-selected={tab.id === active?.id}
              aria-controls={`${panelId}-panel-${tab.id}`}
              className={classNames(styles['tab'], tab.id === active?.id && styles['tabActive'])}
              onClick={() => {
                onSelectTab(tab.id);
                setExpanded(true);
              }}
            >
              {t(tab.labelKey)}
              {tab.badge !== undefined && tab.badge > 0 && (
                <span className={styles['badge']}>{tab.badge}</span>
              )}
            </button>
          ))}
        </div>
        <Button
          variant="secondary"
          iconOnly
          aria-expanded={expanded}
          aria-controls={`${panelId}-panel-${active?.id ?? 'properties'}`}
          aria-label={t(expanded ? 'map.inspector.collapse' : 'map.inspector.expand')}
          title={t(expanded ? 'map.inspector.collapse' : 'map.inspector.expand')}
          onClick={() => setExpanded((current) => !current)}
        >
          <span className={classNames(styles['toggleIcon'], expanded && styles['toggleIconOpen'])}>
            <ChevronDownIcon />
          </span>
        </Button>
      </div>

      {/*
       * EVERY tab stays mounted; only the inactive ones are hidden.
       *
       * Rendering just the active tab unmounted the others, and one of them
       * owns work in progress: a plan upload lives in "Backdrop & layers",
       * and its controller is component state. Switching tabs — including the
       * automatic switch to Properties the moment an object is selected —
       * therefore cancelled an upload halfway through, silently. Before this
       * drawer existed all five panels were mounted at once, so keeping them
       * mounted is also what restores the behaviour people already had.
       */}
      {expanded &&
        tabs.map((tab) => (
          <div
            key={tab.id}
            className={styles['panel']}
            id={`${panelId}-panel-${tab.id}`}
            role="tabpanel"
            aria-labelledby={`${panelId}-${tab.id}`}
            hidden={tab.id !== active?.id}
          >
            {tab.content}
          </div>
        ))}
    </aside>
  );
}
