// Hand-curated bundle entry for the Verdery Web design-system sync.
//
// apps/web has no build step and no dist/ — it's consumed directly by
// Next.js's own bundler. There's also no single source directory that holds
// every synced component: the 14 shared/ui primitives, the icon set, and the
// 13 hand-picked feature composites live under three different top-level
// dirs (shared/, features/*). This file is the single source of truth for
// what's actually in window.<globalName> — every name here must match a
// cfg.componentSrcMap entry in config.json.
//
// Named (not `export *`) so nothing is pulled in by accident.

export {
  Alert,
  Button,
  Card,
  DetailRow,
  FailureAlert,
  ProgressBar,
  RecoveredDraftNotice,
  Select,
  StaleIndicator,
  StatusPill,
  TextArea,
  TextField,
  VisuallyHidden,
} from '../apps/web/shared/ui/public.ts';

export {
  CalendarIcon,
  CheckCircleIcon,
  CursorIcon,
  EyeIcon,
  EyeOffIcon,
  HashIcon,
  HomeIcon,
  LeafIcon,
  LightbulbIcon,
  LockIcon,
  MapIcon,
  PulseIcon,
  RedoIcon,
  RulerIcon,
  SignOutIcon,
  SproutIcon,
  SunIcon,
  TagIcon,
  TrashIcon,
  TypeIcon,
  UndoIcon,
  UnlockIcon,
} from '../apps/web/shared/ui/icons.tsx';

export { SnapshotDataList } from '../apps/web/features/client-portal/snapshot-data-list.tsx';
export { PublicationItemContent } from '../apps/web/features/client-portal/publication-item-content.tsx';
export { ClientPublicationCard } from '../apps/web/features/client-portal/client-publication-card.tsx';
export { ClientTimelineEntry } from '../apps/web/features/client-portal/client-timeline-entry.tsx';

export { MapSaveStatus } from '../apps/web/features/map/map-save-status.tsx';
export { MapWarningsPanel } from '../apps/web/features/map/map-warnings-panel.tsx';
export { MapScaleBadge } from '../apps/web/features/map/map-scale-badge.tsx';
export { MapCategoryIcon } from '../apps/web/features/map/map-category-icon.tsx';

export { TodayDetails } from '../apps/web/features/recommendations/today-details.tsx';

export { RotationConflicts } from '../apps/web/features/seasonal-plan/rotation-conflicts.tsx';
export { SeasonalCalendar } from '../apps/web/features/seasonal-plan/seasonal-calendar.tsx';

export { ContextFactRow } from '../apps/web/features/garden-context/context-fact-row.tsx';

export { ObservationEntry } from '../apps/web/features/observations/observation-entry.tsx';
