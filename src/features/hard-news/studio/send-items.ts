import type { SendItem } from '@/domain';
import type { DeskStudio } from './use-desk-studio';

/**
 * The pre-send checklist of a covered news story: claims the AI flagged and nobody decided come in
 * as a warning, before the summary row. They never block: the editor decides (REQ-2.8).
 */
export function withEvidenceWarning(items: SendItem[], desk: DeskStudio | undefined): SendItem[] {
  if (!desk) return items;
  const pending = desk.flags.filter((flag) => flag.state === 'open' && flag.range);
  if (pending.length === 0) return items;
  const warning: SendItem = {
    id: 'evidence',
    level: 'warning',
    text: pending.length === 1 ? '1 afirmação a conferir' : `${pending.length} afirmações a conferir`,
    action: { label: 'Ver no texto', target: { kind: 'ranges', ranges: pending.flatMap((flag) => (flag.range ? [flag.range] : [])) } },
  };
  const okAt = items.findIndex((item) => item.level === 'ok');
  return okAt < 0 ? [...items, warning] : [...items.slice(0, okAt), warning, ...items.slice(okAt)];
}
