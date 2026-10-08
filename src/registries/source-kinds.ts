import type { SourceKind, SourceOrigin } from '../domain/index.ts';
import type { IconKey } from './icons.ts';
import { availableIn, CURRENT_RELEASE } from './release.ts';
import type { ReleaseId } from './release.ts';

/**
 * Source kinds. R1 ingests authorised transcripts; news (R2), opportunities (R3), media (R4)
 * and events (R7) are reserved with their own intake rules.
 */

export type SourceIntake = {
  /** File extensions accepted by the upload ("Enviar arquivo"). */
  extensions: string[];
  maxBytes: number;
  /** Text can also be pasted ("Colar texto"). */
  paste: boolean;
};

export type SourceKindEntry = {
  kind: SourceKind;
  label: string;
  /** Plural used in lists and empty states. */
  pluralLabel: string;
  icon: IconKey;
  since: ReleaseId;
  /** Generation is blocked until a person confirms the material is authorised (REQ-T.1). */
  requiresAuthorization: boolean;
  intake?: SourceIntake;
};

const TWO_MEGABYTES = 2 * 1024 * 1024;

export const SOURCE_KINDS: readonly SourceKindEntry[] = [
  {
    kind: 'transcript',
    label: 'Transcrição',
    pluralLabel: 'Transcrições',
    icon: 'FileText',
    since: 'R1',
    requiresAuthorization: true,
    intake: { extensions: ['.txt', '.md', '.srt', '.vtt'], maxBytes: TWO_MEGABYTES, paste: true },
  },
  { kind: 'news', label: 'Notícia', pluralLabel: 'Notícias', icon: 'Newspaper', since: 'R2', requiresAuthorization: false },
  { kind: 'opportunity', label: 'Oportunidade', pluralLabel: 'Oportunidades', icon: 'Target', since: 'R3', requiresAuthorization: false },
  { kind: 'media', label: 'Mídia', pluralLabel: 'Mídias', icon: 'FileVideo', since: 'R4', requiresAuthorization: true },
  { kind: 'event', label: 'Evento', pluralLabel: 'Eventos', icon: 'CalendarDays', since: 'R7', requiresAuthorization: false },
];

export function sourceKindsFor(release: ReleaseId = CURRENT_RELEASE): SourceKindEntry[] {
  return availableIn(SOURCE_KINDS, release);
}

export function sourceKind(kind: SourceKind): SourceKindEntry | undefined {
  return SOURCE_KINDS.find((entry) => entry.kind === kind);
}

/** Origins offered in "Contexto › Origem" for transcripts. */
export const SOURCE_ORIGIN_LABELS: Record<SourceOrigin, string> = {
  interview: 'Entrevista',
  podcast: 'Podcast',
  event: 'Painel ou evento',
  talk: 'Palestra',
  other: 'Outro',
};
