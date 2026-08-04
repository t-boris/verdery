import type { ReactNode } from 'react';

import { classNames } from './class-names';
import styles from './route-layout.module.css';

/**
 * Kern's shared route chrome, so every garden section reads as the same
 * application rather than as eight independently styled pages.
 *
 * Plain presentational components with no client state, so a route stays a
 * server component: they take strings and children, never callbacks.
 *
 * The set is deliberately small — a page, a header, a scrolling body, and a
 * panel band. Anything a single route needs beyond that belongs in that
 * route's own stylesheet; anything two routes need belongs here.
 *
 * Source: templates/kern-grid/IMPLEMENTATION.md, sections 2 and 4.
 */
export function RoutePage({ children }: { readonly children: ReactNode }) {
  return <div className={styles['page']}>{children}</div>;
}

export interface RouteHeaderProps {
  readonly title: string;
  readonly description?: string;
  /** Controls belonging to the route as a whole, laid out at the trailing edge. */
  readonly actions?: ReactNode;
}

/**
 * The route's fixed title strip. Always renders the `h1`, so every route has
 * exactly one.
 *
 * Title and description are one group, and the actions are the other. They
 * used to be three siblings under `space-between`, which on a wide display
 * pushed a route's own subtitle to the far edge of the screen, a thousand
 * pixels from the title it belongs to.
 */
export function RouteHeader({ title, description, actions }: RouteHeaderProps) {
  return (
    <div className={styles['header']}>
      <div className={styles['heading']}>
        <h1 className={styles['title']}>{title}</h1>
        {description !== undefined && <p className={styles['description']}>{description}</p>}
      </div>
      {actions}
    </div>
  );
}

/** The route's one scrolling region. The shell above it never scrolls. */
export function RouteBody({ children }: { readonly children: ReactNode }) {
  return <div className={styles['body']}>{children}</div>;
}

export interface RoutePanelProps {
  readonly children: ReactNode;
  /** Mono uppercase band heading. Omit where a heading would only repeat the route title. */
  readonly title?: string;
  /** Take the leftover height and scroll inside, for the panel holding the route's main list. */
  readonly fill?: boolean;
}

export function RoutePanel({ children, title, fill = false }: RoutePanelProps) {
  return (
    <section className={classNames(styles['panel'], fill ? styles['panelFill'] : undefined)}>
      {title !== undefined && <h2 className={styles['panelTitle']}>{title}</h2>}
      {children}
    </section>
  );
}

/** Main content beside a narrower secondary column, divided by the same hairline as everything else. */
export function RouteSplit({ children }: { readonly children: ReactNode }) {
  return <div className={styles['split']}>{children}</div>;
}
