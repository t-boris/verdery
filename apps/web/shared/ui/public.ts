/**
 * Public surface of the shared design system.
 *
 * Shared UI stays domain neutral: it knows about tone, state, and layout, and
 * never about gardens, plants, or tasks.
 *
 * Source: architecture/web-application-design.md, section "20. Dependency Rules".
 */
export { Alert, type AlertProps, type AlertTone } from './alert';
export { ActionDisclosure, type ActionDisclosureProps } from './action-disclosure';
export { Button, type ButtonProps, type ButtonVariant } from './button';
export { Card, type CardProps } from './card';
export { CommandSurface, type CommandSurfaceProps } from './command-surface';
export { DetailRow, type DetailRowProps } from './detail-row';
export { FailureAlert } from './failure-alert';
export { FieldGrid, type FieldGridProps } from './field-grid';
export { FilePicker, type FilePickerProps } from './file-picker';
export {
  ArrowRightIcon,
  BookIcon,
  BuildingIcon,
  CalendarIcon,
  CheckIcon,
  ChevronDownIcon,
  CloseIcon,
  CheckCircleIcon,
  CursorIcon,
  FitIcon,
  EyeIcon,
  EyeOffIcon,
  HashIcon,
  HomeIcon,
  LeafIcon,
  LightbulbIcon,
  ImageIcon,
  LockIcon,
  MapIcon,
  PauseIcon,
  MinusIcon,
  PlusIcon,
  PulseIcon,
  RefreshIcon,
  RedoIcon,
  RulerIcon,
  SignOutIcon,
  SearchIcon,
  SparklesIcon,
  SproutIcon,
  SunIcon,
  TagIcon,
  TrashIcon,
  TypeIcon,
  UndoIcon,
  UnlockIcon,
  UploadIcon,
  type IconProps,
} from './icons';
export { Label, type LabelProps } from './label';
export { ProgressBar, type ProgressBarProps } from './progress-bar';
export { PhotoLightbox, type LightboxPhoto, type PhotoLightboxProps } from './photo-lightbox';
export {
  RouteBody,
  RouteDashboard,
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
