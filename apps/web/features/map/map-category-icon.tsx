import type { GardenObjectCategory } from '@verdery/geometry-contracts';
import type { ReactNode } from 'react';

interface MapCategoryIconProps {
  readonly category: GardenObjectCategory;
  readonly size?: number;
}

function pathsFor(category: GardenObjectCategory): ReactNode {
  switch (category) {
    case 'lot':
      return <path d="M3 4.5 15.5 3l1.5 13-13.5 1Z" />;
    case 'structure':
      return (
        <>
          <path d="m3 9 7-5.5L17 9" />
          <path d="M5 8v8h10V8M8.5 16v-4h3v4" />
        </>
      );
    case 'fence':
      return <path d="M3 6h14M3 14h14M5 4v12M10 4v12M15 4v12" />;
    case 'gate':
      return <path d="M4 16V5l12 2v9M4 8l12 6M16 8 4 14" />;
    case 'path':
      return <path d="M6 18c6-4-2-7 6-11 2-1 2-3 2-5" />;
    case 'zone':
      return <path d="M3 10c2-5 5-7 9-6 3 1 5 4 4 8-1 4-5 5-9 4-3-1-5-3-4-6Z" />;
    case 'bed':
      return (
        <>
          <rect x="3" y="5" width="14" height="10" rx="2" />
          <path d="M6 8h8M6 12h8" />
        </>
      );
    case 'waterFeature':
      return <path d="M10 2.5c3 4 5 6.5 5 9a5 5 0 0 1-10 0c0-2.5 2-5 5-9Z" />;
    case 'utilityExclusion':
      return (
        <>
          <circle cx="10" cy="10" r="7" />
          <path d="M5 15 15 5" />
        </>
      );
    case 'tree':
      return (
        <>
          <path d="M10 17v-5" />
          <circle cx="10" cy="7.5" r="5" />
        </>
      );
    case 'plant':
      return (
        <>
          <path d="M10 17v-7" />
          <path d="M10 11C7 11 5 9 5 6c3 0 5 2 5 5ZM10 12c0-3 2-5 5-5 0 3-2 5-5 5Z" />
        </>
      );
    case 'annotation':
      return (
        <>
          <circle cx="10" cy="10" r="7" />
          <path d="M10 9v5M10 6.2v.2" />
        </>
      );
    case 'importedBackground':
      return (
        <>
          <rect x="3" y="3.5" width="14" height="13" rx="1.5" />
          <path d="m5 13 3-3 2 2 2.5-3 2.5 4" />
        </>
      );
  }
}

/** Domain-specific map category symbol; color comes from the surrounding control. */
export function MapCategoryIcon({ category, size = 18 }: MapCategoryIconProps) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {pathsFor(category)}
    </svg>
  );
}
