'use client';

import { useId, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';

import { useLocalization } from '@/shared/localization/public';
import { Button, FitIcon, MinusIcon, PlusIcon, classNames } from '@/shared/ui/public';
import type { MessageKey } from '@/shared/localization/public';

import styles from './map-inspector-drawer.module.css';
import {
  narrowerInspectorWidth,
  widerInspectorWidth,
  type MapInspectorWidth,
} from './map-inspector-layout';

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
  readonly width: MapInspectorWidth;
  readonly onWidthChange: (width: MapInspectorWidth) => void;
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
 * The four sections stay explicit tabs. The panel deliberately has no generic
 * chevron/collapse control: that affordance was mistaken for a section menu
 * and did not make the workspace easier to understand. Desktop users can
 * instead choose a narrow, standard, or wide readable panel width.
 *
 * Source: architecture/web-application-design.md, section "5. Application
 * Structure"; architecture/map-rendering-and-editing.md, section "13. Web
 * Rendering".
 */
export function MapInspectorDrawer({
  tabs,
  activeTab,
  onSelectTab,
  width,
  onWidthChange,
}: MapInspectorDrawerProps) {
  const { t } = useLocalization();
  const panelId = useId();
  const active = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const moveTabFocus = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const next = tabs[nextIndex];
    tabRefs.current[nextIndex]?.focus();
    if (next !== undefined) onSelectTab(next.id);
  };

  return (
    <aside className={styles['drawer']} aria-label={t('map.inspector.ariaLabel')}>
      <div className={styles['header']}>
        <div className={styles['tabs']} role="tablist" aria-label={t('map.inspector.ariaLabel')}>
          {tabs.map((tab, index) => (
            <button
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              key={tab.id}
              type="button"
              role="tab"
              id={`${panelId}-${tab.id}`}
              aria-selected={tab.id === active?.id}
              aria-controls={`${panelId}-panel-${tab.id}`}
              tabIndex={tab.id === active?.id ? 0 : -1}
              className={classNames(styles['tab'], tab.id === active?.id && styles['tabActive'])}
              onClick={() => {
                onSelectTab(tab.id);
              }}
              onKeyDown={(event) => moveTabFocus(event, index)}
            >
              {t(tab.labelKey)}
              {tab.badge !== undefined && tab.badge > 0 && (
                <span className={styles['badge']}>{tab.badge}</span>
              )}
            </button>
          ))}
        </div>
        <div className={styles['widthControls']} role="group" aria-label={t('map.inspector.width')}>
          <span className={styles['widthLabel']}>{t('map.inspector.width')}</span>
          <Button
            variant="secondary"
            iconOnly
            disabled={width === 'narrow'}
            aria-label={t('map.inspector.narrow')}
            title={t('map.inspector.narrow')}
            onClick={() => onWidthChange(narrowerInspectorWidth(width))}
          >
            <MinusIcon />
          </Button>
          <Button
            variant="secondary"
            iconOnly
            disabled={width === 'standard'}
            aria-label={t('map.inspector.resetWidth')}
            title={t('map.inspector.resetWidth')}
            onClick={() => onWidthChange('standard')}
          >
            <FitIcon />
          </Button>
          <Button
            variant="secondary"
            iconOnly
            disabled={width === 'wide'}
            aria-label={t('map.inspector.widen')}
            title={t('map.inspector.widen')}
            onClick={() => onWidthChange(widerInspectorWidth(width))}
          >
            <PlusIcon />
          </Button>
        </div>
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
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={classNames(styles['panel'], tab.id === 'backdrop' && styles['panelComfort'])}
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
