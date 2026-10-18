import { Badge } from '@content-ventures/design-system/v3';
import type { Tone } from '@content-ventures/design-system/v3';
import { PRIORITY_LABELS } from '@/domain/hard-news';
import type { NewsPriority } from '@/domain/hard-news';

/** Orange asks for action now; red is kept for failures (a source down). */
const TONES: Record<NewsPriority, Tone> = { high: 'orange', medium: 'amber', low: 'gray' };

/**
 * The AI's priority as status: dot + word ("Alta") on the radar; "Alta · 91" where the score
 * itself is the point (the editorial map's preview).
 */
export function PriorityBadge({ priority, score, variant = 'text', size = 'md' }: {
  priority: NewsPriority;
  score?: number;
  variant?: 'text' | 'soft';
  size?: 'sm' | 'md';
}) {
  const label = score === undefined ? PRIORITY_LABELS[priority] : `${PRIORITY_LABELS[priority]} · ${score}`;
  return <Badge tone={TONES[priority]} variant={variant} size={size} dot>{label}</Badge>;
}
