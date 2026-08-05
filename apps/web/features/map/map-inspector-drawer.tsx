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
              aria-controls={panelId}
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
          aria-controls={panelId}
          aria-label={t(expanded ? 'map.inspector.collapse' : 'map.inspector.expand')}
          title={t(expanded ? 'map.inspector.collapse' : 'map.inspector.expand')}
          onClick={() => setExpanded((current) => !current)}
        >
          <span className={classNames(styles['toggleIcon'], expanded && styles['toggleIconOpen'])}>
            <ChevronDownIcon />
          </span>
        </Button>
      </div>

      {expanded && active !== undefined && (
        <div
          className={styles['panel']}
          id={panelId}
          role="tabpanel"
          aria-labelledby={`${panelId}-${active.id}`}
        >
          {active.content}
        </div>
      )}
    </aside>
  );
}
