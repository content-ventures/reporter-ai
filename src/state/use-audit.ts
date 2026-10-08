'use client';

import { useMemo } from 'react';
import type { AuditEventId } from '../domain/audit.ts';
import type { AuditEntry, AuditFilter, AuditPage } from '../ports/audit.ts';
import type { PageRequest } from '../ports/common.ts';
import { auditEventQuery, auditQuery } from './audit-specs.ts';
import type { QueryState } from './query-state.ts';
import { useQuery } from './use-queries.ts';
import { useRuntime } from './use-runtime.ts';

/**
 * Logs (F1.7). `restricted` and `unavailable` arrive as query errors with those codes, so the
 * screen draws AccessState or "Log indisponível" from the same state it reads rows from.
 */
export function useAudit(filter?: AuditFilter, page?: Partial<PageRequest>): QueryState<AuditPage> {
  return useQuery(auditQuery(filter, page));
}

/** One entry by id (the drawer of a shared `?event=` link); `null` reads nothing. */
export function useAuditEvent(eventId: AuditEventId | null | undefined): QueryState<AuditEntry> {
  return useQuery(eventId ? auditEventQuery(eventId) : null);
}

export type AuditControls = {
  /** ⌘K › Simulação: the next read of the trail fails as "Log indisponível" (simulated mode only). */
  simulateOutage?: () => void;
};

export function useAuditControls(): AuditControls {
  const { runtime } = useRuntime();
  return useMemo(() => {
    const audit = runtime?.audit;
    return audit?.simulateOutage ? { simulateOutage: () => audit.simulateOutage?.() } : {};
  }, [runtime]);
}
