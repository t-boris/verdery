import type { ReactNode } from 'react';

import styles from './detail-row.module.css';

export interface DetailRowProps {
  readonly icon: ReactNode;
  readonly label: string;
  readonly value: string;
}

/**
 * One labelled fact: icon left, label above value on the right, with real
 * line height — not a single `${label}: ${value}` line, which crushes a full
 * sentence onto one crowded row. Domain neutral: originally private to
 * `features/plants/plant-detail.tsx` (mirroring iOS's
 * `PlantIdentificationBannerView.detailRow`), promoted here once
 * `features/candidates/candidate-detail.tsx` needed the identical building
 * block — a feature must not import another feature's component
 * (architecture/web-application-design.md, section "20. Dependency Rules").
 */
export function DetailRow({ icon, label, value }: DetailRowProps) {
  return (
    <div className={styles['row']}>
      <span className={styles['icon']}>{icon}</span>
      <div>
        <span className={styles['label']}>{label}</span>
        <p className={styles['value']}>{value}</p>
      </div>
    </div>
  );
}
