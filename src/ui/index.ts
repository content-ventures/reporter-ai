/**
 * Reporter compositions shared by several screens. Everything here is built from the public
 * Design System (`@content-ventures/design-system/v3`) and reads data through `@/state`.
 */
export * from './shell';
export { StatusBadge, statusPresentation, type StatusBadgeProps, type StatusKind, type StatusPresentation, type StatusRef } from './status-badge';
export { RunTrace, runDuration, runSummary, traceSteps, type RunTraceProps, type TraceableRun } from './run-trace';
export { Provenance, describeRef, summarizeInputs, type ProvenanceProps, type ProvenanceRun } from './provenance';
export { SourceChipFor, resolveChip, type ResolvedChip, type SourceChipForProps } from './source-chip-for';
export { PersonAvatar, usePerson, type PersonAvatarProps } from './person-avatar';
export { ChecksList, checkProgress, type ChecksListProps } from './checks-list';
export { RelativeTime, useNow, useRelativeTime } from './time';
export { formatCount, formatDate, formatDateTime, formatDuration, formatListDateTime, formatShortDate, plural } from './format';
export { useDocumentTitle, PRODUCT_NAME } from './use-document-title';
export { ICONS, iconFor } from './icons';
export * from './routes';
