/** Local simulated audit trail (F1.7): imported only by src/runtime and tests. */
export { AUDIT_STORAGE_KEY, createLocalAudit } from './local-audit.ts';
export type { LocalAudit, LocalAuditOptions } from './local-audit.ts';
export { auditFromActivity } from './from-activity.ts';
export { updatesBetween } from './state-diff.ts';
