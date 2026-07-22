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
export { StatusPill, type StatusPillProps, type StatusTone } from './status-pill';
export { VisuallyHidden, type VisuallyHiddenProps } from './visually-hidden';
export { classNames } from './class-names';
