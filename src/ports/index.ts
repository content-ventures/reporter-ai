/**
 * Port interfaces: the only surface screens and state hooks know. The local simulated adapter
 * implements them now; a backend/AI adapter replaces it later and must pass the same contract
 * suites (`src/ports/contracts/*.contract.ts`).
 */

export * from './common.ts';
export * from './system.ts';
export * from './session.ts';
export * from './feedback.ts';
export * from './save-status.ts';
export * from './source-ingest.ts';
export * from './production-queries.ts';
export * from './production-commands.ts';
export * from './generation.ts';
export * from './script-book.ts';
export * from './render.ts';
export * from './export.ts';
export * from './assets.ts';
export * from './audit.ts';
