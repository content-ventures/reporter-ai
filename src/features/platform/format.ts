import type { MetricDelta, SegmentOption, Tone } from '@content-ventures/design-system/v3';
import { ACCESS_STATUS_LABELS, roleLabel, type AccessStatus, type Role, type UsagePeriod } from '@/domain';
import { formatCount } from '@/ui/format';

/** Console da plataforma: numbers, money, periods and statuses as the screens show them. */

export const PLATFORM_HREF = '/platform';
export const PEOPLE_HREF = '/platform/people';
export const USAGE_HREF = '/platform/usage';
export const LOG_HREF = '/platform/log';

export const PERIOD_OPTIONS: SegmentOption<`${UsagePeriod}`>[] = [
  { value: '7', label: '7 dias' },
  { value: '30', label: '30 dias' },
  { value: '90', label: '90 dias' },
];

/** Status = dot + word (DS §2.4): open link waits for another person, a sign-up needs action now. */
export const STATUS_TONES: Readonly<Record<AccessStatus, Tone>> = {
  active: 'green',
  invited: 'violet',
  pending: 'orange',
  suspended: 'gray',
};

export function statusLabel(status: AccessStatus): string {
  return ACCESS_STATUS_LABELS[status];
}

/** "Editor, Admin" — or "Sem função" while pending. */
export function rolesLabel(roles: readonly Role[]): string {
  return roles.length ? roles.map(roleLabel).join(', ') : 'Sem função';
}

/** "1,24 mi", "25 mil", "812". */
export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  const fixed = (number: number) => number.toLocaleString('pt-BR', { maximumFractionDigits: number < 10 ? 2 : 1 });
  if (abs >= 1_000_000_000) return `${fixed(value / 1_000_000_000)} bi`;
  if (abs >= 1_000_000) return `${fixed(value / 1_000_000)} mi`;
  if (abs >= 10_000) return `${fixed(value / 1_000)} mil`;
  return formatCount(value);
}

/** "US$ 12,34"; under a cent, "< US$ 0,01". */
export function formatUsd(value: number): string {
  if (value > 0 && value < 0.005) return '< US$ 0,01';
  return `US$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "45 min", "12 h 05 min". */
export function formatMinutes(minutes: number): string {
  const total = Math.round(minutes);
  if (total < 60) return `${total} min`;
  return `${formatCount(Math.floor(total / 60))} h ${String(total % 60).padStart(2, '0')} min`;
}

/** "16/10" for the axis, "16/10/2026 · sexta" for the tooltip. */
export function dayLabel(day: string): { label: string; title: string } {
  const date = new Date(`${day}T12:00:00.000Z`);
  const [year, month, date2] = day.split('-');
  const weekday = date.toLocaleDateString('pt-BR', { weekday: 'long', timeZone: 'UTC' }).replace('-feira', '');
  return { label: `${date2}/${month}`, title: `${date2}/${month}/${year} · ${weekday}` };
}

/**
 * The change against the period before: "12%" up or down. `costly` flips the tone (more spend
 * is not good news). Nothing when there is no base to compare with.
 */
export function deltaOf(current: number, previous: number, period: UsagePeriod, costly = false): MetricDelta | undefined {
  if (previous <= 0) return undefined;
  const change = (current - previous) / previous;
  const percent = Math.abs(change * 100);
  const trend = percent < 0.5 ? 'flat' : change > 0 ? 'up' : 'down';
  const shown = `${percent.toLocaleString('pt-BR', { maximumFractionDigits: percent < 10 ? 1 : 0 })}%`;
  const word = trend === 'flat' ? 'estável' : trend === 'up' ? 'alta' : 'queda';
  return {
    value: shown,
    trend,
    tone: trend === 'flat' ? 'flat' : (trend === 'up') !== costly ? 'good' : 'bad',
    label: `${word} de ${shown} contra os ${period} dias anteriores`,
  };
}
