/**
 * Data-driven extension points. Every entry has `since: 'R0'..'R7'`; screens read the entries of
 * `CURRENT_RELEASE`, and later releases plug in by adding entries, not screens.
 */

export * from './release.ts';
export * from './icons.ts';
export * from './navigation.ts';
export * from './source-kinds.ts';
export * from './piece-kinds.ts';
export * from './gates.ts';
export * from './flows.ts';
export * from './checks.ts';
export * from './image-sources.ts';
export * from './channels.ts';
export * from './recipes.ts';
export * from './sizing.ts';
export * from './copilot.ts';
export * from './dashboard.ts';
export * from './status-vocabulary.ts';
