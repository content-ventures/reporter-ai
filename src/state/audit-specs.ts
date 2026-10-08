import type { AuditEventId } from '../domain/audit.ts';
import { stableStringify } from '../domain/text/hash.ts';
import type { AuditEntry, AuditFilter, AuditPage } from '../ports/audit.ts';
import type { ChangeNotice, PageRequest } from '../ports/common.ts';
import type { RuntimeQuery } from './query-specs.ts';

/**
 * Cache specs of the Logs screen. The trail grows with every semantic change (activity), record
 * update (rename, brief, speakers), session switch, reset and reload from another tab, and with
 * its own `audit` notices (live denials, simulated outages); streaming deltas and image changes
 * leave it alone.
 */

export function touchesAudit(notice: ChangeNotice): boolean {
  return (
    notice.scope === 'audit' ||
    notice.scope === 'session' ||
    notice.scope === 'reset' ||
    notice.scope === 'external' ||
    notice.scope === 'productions' ||
    notice.activity.length > 0
  );
}

const key = (name: string, ...args: unknown[]): string => {
  let count = args.length;
  while (count > 0 && args[count - 1] === undefined) count -= 1;
  return count === 0 ? name : `${name}:${stableStringify(args.slice(0, count))}`;
};

export function auditQuery(filter?: AuditFilter, page?: Partial<PageRequest>): RuntimeQuery<AuditPage> {
  return { key: key('audit', filter ?? {}, page), fetch: (rt) => rt.audit.list(filter, page), affectedBy: touchesAudit };
}

export function auditEventQuery(eventId: AuditEventId): RuntimeQuery<AuditEntry> {
  return { key: key('audit-event', eventId), fetch: (rt) => rt.audit.get(eventId), affectedBy: touchesAudit };
}
