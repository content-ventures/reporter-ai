import { AUDIT_TYPE_LABELS } from '../../domain/audit.ts';
import type { AuditResult } from '../../domain/audit.ts';
import type { AuditEntry } from '../../ports/audit.ts';

/**
 * Text of the Logs screen that depends only on the entry (pure, covered by `node --test`).
 * Tones follow PLAN §3: success is the quiet norm (gray), a denial asks for attention (amber),
 * a failure is an error (red). Green stays reserved for "no ar".
 */

export type ResultTone = 'gray' | 'amber' | 'red';

export const RESULT_TONES: Record<AuditResult, ResultTone> = { success: 'gray', denied: 'amber', failure: 'red' };

/** Second line under the action: why it was refused or failed, else which fields changed. */
export function actionDetail(entry: Pick<AuditEntry, 'reason' | 'changes' | 'result'>): string | undefined {
  if (entry.result !== 'success' && entry.reason) return entry.reason;
  const fields = entry.changes?.map((change) => change.field) ?? [];
  if (fields.length === 0) return undefined;
  return fields.length <= 2 ? fields.join(' · ') : `${fields.slice(0, 2).join(' · ')} +${fields.length - 2}`;
}

/**
 * Second line under the record: its production (renamed or not); for a sign-in, the masked IP;
 * else the area of the action.
 */
export function itemContext(entry: Pick<AuditEntry, 'target' | 'productionTitle' | 'type' | 'origin'>): string {
  const target = entry.target;
  if (target?.productionId && target.kind !== 'production') return entry.productionTitle ?? 'Produção removida';
  if (!target && entry.origin.ip) return entry.origin.ip;
  return AUDIT_TYPE_LABELS[entry.type];
}

/**
 * The record's name: a production shows its current title (the entry keeps the old one in its
 * changes); an event without a record (sign-in, sign-out) shows where it came from.
 */
export function itemLabel(entry: Pick<AuditEntry, 'target' | 'productionTitle' | 'origin'>): string {
  const target = entry.target;
  if (!target) return originLabel(entry);
  if (target.kind === 'production' && entry.productionTitle) return entry.productionTitle;
  return target.label;
}

/**
 * "Último há 2 h", "Último ontem", "Último em 12 out": when the latest denial or failure happened,
 * from the DS relative time.
 */
export function lastSeen(relative: string, gender: 'm' | 'f'): string | undefined {
  if (!relative) return undefined;
  const word = gender === 'f' ? 'Última' : 'Último';
  return /^(há|agora|ontem|hoje)/.test(relative) ? `${word} ${relative}` : `${word} em ${relative}`;
}

const pad = (value: number) => String(value).padStart(2, '0');

/** "07/10/2026 às 14:32:05" (local time; audit precision includes seconds). */
export function auditInstant(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '—';
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} às ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** "Chrome · macOS", "Este navegador"; runs settled by the simulation read "Sistema". */
export function originLabel(entry: Pick<AuditEntry, 'origin'>): string {
  if (entry.origin.device) return entry.origin.device;
  return entry.origin.channel === 'system' ? 'Sistema' : 'Web';
}
