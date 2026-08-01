/**
 * Public surface of the shared design system.
 *
 * Shared UI stays domain neutral: it knows about tone, state, and layout, and
 * never about gardens, plants, or tasks.
 *
 * Source: architecture/web-application-design.md, section "20. Dependency Rules".
 */
export { Alert, type AlertProps, type AlertTone } from './alert';
export { Button, type ButtonProps, type ButtonVariant } from './button';
export { Card, type CardProps } from './card';
export { DetailRow, type DetailRowProps } from './detail-row';
export { FailureAlert } from './failure-alert';
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
  type IconProps,
} from './icons';
export { Label, type LabelProps } from './label';
export { ProgressBar, type ProgressBarProps } from './progress-bar';
export {
  RouteBody,
  RouteHeader,
  RoutePage,
  RoutePanel,
  RouteSplit,
  type RouteHeaderProps,
  type RoutePanelProps,
} from './route-layout';
export { RecoveredDraftNotice, type RecoveredDraftNoticeProps } from './recovered-draft-notice';
export { Select, type SelectOption, type SelectProps } from './select';
export { StaleIndicator, type StaleIndicatorProps } from './stale-indicator';
export {
  StatusBar,
  StatusBarFieldsProvider,
  usePublishStatusBarFields,
  type StatusBarField,
  type StatusBarProps,
} from './status-bar';
export { StatusPill, type StatusPillProps, type StatusTone } from './status-pill';
export { TextArea, type TextAreaProps } from './text-area';
export { TextField, type TextFieldProps } from './text-field';
export { VisuallyHidden, type VisuallyHiddenProps } from './visually-hidden';
export { classNames } from './class-names';
