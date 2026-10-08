'use client';

import { SourceChip, type SourceChipState, type SourceKind } from '@content-ventures/design-system/v3';
import { formatTimestamp, resolveSourceRef, type Source, type SourceRef } from '@/domain';
import type { EvidenceView, PersonSummary } from '@/ports';

/**
 * A typed `SourceRef` drawn as the DS SourceChip: the speaker (mapped person or transcript label)
 * as label, timestamp as meta, the exact excerpt as preview. A reference that does not resolve in
 * the cited source version is `missing` ("Falta", red) — the deterministic quote check (§3.5).
 */

const KIND_BY_LOCATOR: Record<SourceRef['locator']['type'], SourceKind> = {
  segment: 'excerpt',
  url: 'url',
  quote: 'quote',
  media: 'media',
};

export type ResolvedChip = {
  kind: SourceKind;
  label: string;
  meta?: string;
  preview?: string;
  resolved: boolean;
};

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Label, meta and preview of a reference, from the production sources or ready evidence. */
export function resolveChip(
  sourceRef: SourceRef,
  options: { sources?: readonly Source[]; evidence?: EvidenceView; people?: readonly PersonSummary[] } = {},
): ResolvedChip {
  const kind = KIND_BY_LOCATOR[sourceRef.locator.type];
  const { locator } = sourceRef;
  if (options.evidence) {
    const { evidence } = options;
    const speaker = evidence.speaker?.person?.name ?? evidence.speaker?.label;
    return {
      kind,
      label: speaker ?? (locator.type === 'url' ? hostOf(locator.url) : 'Trecho'),
      meta: speaker && evidence.speaker?.person && evidence.speaker.label !== speaker ? evidence.speaker.label : undefined,
      preview: evidence.excerpt ? `“${evidence.excerpt}”` : undefined,
      resolved: evidence.status === 'used',
    };
  }
  const resolved = options.sources ? resolveSourceRef(options.sources, sourceRef) : undefined;
  if (!resolved) {
    return { kind, label: locator.type === 'url' ? hostOf(locator.url) : 'Trecho', resolved: false };
  }
  const person = resolved.speaker?.personId ? options.people?.find((entry) => entry.id === resolved.speaker?.personId) : undefined;
  const speakerLabel = resolved.speaker?.label ?? resolved.segment?.speaker;
  const time = resolved.segment?.startMs !== undefined ? formatTimestamp(resolved.segment.startMs) : undefined;
  const meta = [person && speakerLabel && speakerLabel !== person.name ? speakerLabel : undefined, time].filter(Boolean).join(' · ');
  return {
    kind,
    label: person?.name ?? speakerLabel ?? (locator.type === 'url' ? hostOf(locator.url) : resolved.source.title),
    meta: meta || undefined,
    preview: resolved.excerpt ? `“${resolved.excerpt}”` : undefined,
    resolved: true,
  };
}

export type SourceChipForProps = {
  sourceRef: SourceRef;
  /** Sources of the production (`SourceDetail.source`) to resolve the excerpt. */
  sources?: readonly Source[];
  /** Review evidence (already resolved, with `used` / `missing`). */
  evidence?: EvidenceView;
  /** To name mapped speakers (usePeople). */
  people?: readonly PersonSummary[];
  /** Default: `used`/`missing` from evidence; `missing` when the ref does not resolve. */
  state?: SourceChipState;
  variant?: 'chip' | 'inline';
  index?: number;
  onOpen?: () => void;
  openLabel?: string;
  onRemove?: () => void;
  disabled?: boolean;
  /** `speaker` (default) names who said it · `excerpt` leads with the words, speaker and time as meta. */
  show?: 'speaker' | 'excerpt';
};

/** "“A palavra que eu mais…”" for an excerpt-first chip. */
function excerptLabel(preview: string | undefined): string | undefined {
  const text = preview?.replace(/^“|”$/g, '').replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  const words = text.split(' ');
  return words.length <= 5 ? `“${text}”` : `“${words.slice(0, 5).join(' ').replace(/[,.;:]$/, '')}…”`;
}

export function SourceChipFor({
  sourceRef,
  sources,
  evidence,
  people,
  state,
  variant = 'chip',
  index,
  onOpen,
  openLabel,
  onRemove,
  disabled,
  show = 'speaker',
}: SourceChipForProps) {
  const chip = resolveChip(sourceRef, { sources, evidence, people });
  const fallbackState: SourceChipState = evidence ? (evidence.status === 'used' ? 'used' : 'missing') : chip.resolved ? 'default' : 'missing';
  const excerpt = show === 'excerpt' ? excerptLabel(chip.preview) : undefined;
  return (
    <SourceChip
      kind={chip.kind}
      label={excerpt ?? chip.label}
      meta={excerpt ? [chip.label, chip.meta].filter(Boolean).join(' · ') : chip.meta}
      preview={chip.preview}
      state={state ?? fallbackState}
      variant={variant}
      index={index}
      onOpen={onOpen}
      openLabel={openLabel}
      onRemove={onRemove}
      disabled={disabled}
    />
  );
}
