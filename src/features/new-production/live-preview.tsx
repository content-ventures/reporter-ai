'use client';

import { useMemo } from 'react';
import {
  Avatar,
  CardHeader,
  DescriptionList,
  List,
  ListItem,
  MetaList,
  Panel,
  Section,
  SkeletonText,
  formatTimestamp,
  type DescriptionItem,
  type TranscriptSegment,
} from '@content-ventures/design-system/v3';
import { LENGTH_TARGETS, PIECE_LABELS, SIMULATED_MODEL, expectedDraftWords, personLine } from '@/domain';
import type { PersonSummary, SourceAnalysis } from '@/ports';
import { SOURCE_ORIGIN_LABELS } from '@/registries';
import { formatCount, formatShortDate, plural } from '@/ui/format';
import {
  planKinds,
  speakerChoice,
  speakerDisplayName,
  structureLabel,
  type NewProductionDraft,
  type SpeakerChoice,
} from './form';

/**
 * Live preview of the production (reference 3, PLAN §3.3): how the article will be born from
 * this material — the proposed headline, the sections the questions support, the key lines it
 * will quote (with who says them) and the length target — with the material's numbers in one
 * line. Updated as the form changes; nothing here is editable.
 */

export type PreviewSpeaker = {
  label: string;
  name: string;
  choice: SpeakerChoice;
  /** Role and organisation as the text will say them ("diretora de marketing da Casa Forma"). */
  line?: string;
  avatarUrl?: string;
  segments: number;
};

/** Speakers as the production will show them (linked person, new name or raw label). */
export function usePreviewSpeakers(
  choices: NewProductionDraft['speakers'],
  analysis: SourceAnalysis | undefined,
  people: readonly PersonSummary[],
): PreviewSpeaker[] {
  return useMemo(
    () =>
      (analysis?.speakers ?? []).map((speaker) => {
        const choice = speakerChoice({ speakers: choices }, speaker.label, people);
        const person = choice.kind === 'person' ? people.find((candidate) => candidate.id === choice.personId) : undefined;
        const entry: PreviewSpeaker = {
          label: speaker.label,
          name: speakerDisplayName(choice, speaker.label, people),
          choice,
          segments: speaker.segments,
        };
        if (person?.avatarUrl) entry.avatarUrl = person.avatarUrl;
        const line = person ? (person.line ?? person.title) : choice.kind === 'new' ? personLine(choice) : undefined;
        if (line) entry.line = line;
        return entry;
      }),
    [analysis, choices, people],
  );
}

/** Speakers the draft names (a person, existing or new), for the outlook's headline. */
export function namesForOutlook(speakers: readonly PreviewSpeaker[]): Record<string, string> {
  const names: Record<string, string> = {};
  for (const speaker of speakers) if (speaker.choice.kind === 'person' || speaker.choice.kind === 'new') names[speaker.label] = speaker.name;
  return names;
}

/** Segments for the DS TranscriptViewer, speakers named after "Falantes". */
export function useViewerSegments(analysis: SourceAnalysis | undefined, speakers: readonly PreviewSpeaker[]): TranscriptSegment[] {
  return useMemo(() => {
    if (!analysis) return [];
    const byLabel = new Map(speakers.map((speaker) => [speaker.label, speaker]));
    return analysis.segments.map((segment) => {
      const entry: TranscriptSegment = { id: segment.id, text: segment.text };
      const speaker = segment.speaker ? byLabel.get(segment.speaker) : undefined;
      if (segment.speaker) {
        entry.speaker = { id: segment.speaker, name: speaker?.name ?? segment.speaker };
        if (speaker?.avatarUrl) entry.speaker.src = speaker.avatarUrl;
      }
      if (segment.startMs !== undefined) entry.start = segment.startMs;
      if (segment.endMs !== undefined) entry.end = segment.endMs;
      return entry;
    });
  }, [analysis, speakers]);
}

function speakerDetail(speaker: PreviewSpeaker): string {
  const falas = plural(speaker.segments, 'fala', 'falas');
  if (speaker.choice.kind === 'new') return [speaker.line ?? 'Nova pessoa', falas].join(' · ');
  if (speaker.choice.kind === 'none') return `Sem atribuição · ${falas}`;
  if (speaker.choice.kind === 'unset') return `Sem pessoa · ${falas}`;
  if (speaker.line) return `${speaker.line} · ${falas}`;
  return speaker.name === speaker.label ? falas : `${speaker.label} · ${falas}`;
}

export type LivePreviewProps = {
  draft: NewProductionDraft;
  analysis: SourceAnalysis | undefined;
  /** First read of the material in progress (no earlier answer to keep on screen). */
  loading: boolean;
  speakers: readonly PreviewSpeaker[];
};

/** "“A palavra que eu mais tenho ouvido…”" for a list row. */
function clipLine(text: string, max = 120): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(' ') > max * 0.6 ? cut.lastIndexOf(' ') : max).trimEnd()}…`;
}

export function LivePreview({ draft, analysis, loading, speakers }: LivePreviewProps) {
  const stats = analysis?.stats;
  const outlook = analysis?.outlook;
  const origin = [SOURCE_ORIGIN_LABELS[draft.origin], draft.recordedOn ? formatShortDate(draft.recordedOn) : null].filter(Boolean).join(' · ');
  const numbers = stats
    ? [
        { value: plural(stats.words, 'palavra', 'palavras'), numeric: true },
        { value: `${formatCount(stats.readingMinutes)} min de leitura`, numeric: true },
        { value: plural(stats.segments, 'fala', 'falas'), numeric: true },
        stats.durationMs !== undefined ? { value: formatTimestamp(stats.durationMs), numeric: true } : null,
      ]
    : [];
  const target = LENGTH_TARGETS[draft.length];
  const expected = outlook ? expectedDraftWords(draft.length, outlook.wordsAvailable) : undefined;
  const sections = outlook ? Math.min(draft.sections, Math.max(1, outlook.sections)) : draft.sections;
  const structure = [
    structureLabel(sections),
    outlook && outlook.sections < draft.sections ? `o material sustenta ${plural(outlook.sections, 'seção', 'seções')}` : null,
    // The draft lands on the target when the material reaches it; a short material gives less, never invented text.
    expected && !expected.reachesTarget
      ? expected.words > 0
        ? `≈ ${formatCount(expected.words)} de ${formatCount(target.words)} palavras`
        : null
      : `≈ ${formatCount(target.words)} palavras`,
  ].filter(Boolean) as string[];
  const bySpeaker = new Map(speakers.map((speaker) => [speaker.label, speaker]));
  const details: DescriptionItem[] = [
    { label: 'Orientação', value: draft.angle.trim() || undefined },
    { label: 'Entregas', value: planKinds(draft.plan).map((kind, index) => (index === 0 ? PIECE_LABELS[kind] : PIECE_LABELS[kind].toLowerCase())).join(' e ') },
  ];

  return (
    <Panel label="Prévia da produção">
      <Section title={draft.title.trim() || 'Sem título'} meta={origin} titleAs="h2">
        {loading ? <SkeletonText lines={1} label="Lendo o material" /> : numbers.length > 0 ? <MetaList size="sm" items={numbers} label="Material" /> : <MetaList size="sm" items={['Sem material']} />}
      </Section>
      <Section title="Como o artigo nasce" titleAs="h2" meta={SIMULATED_MODEL.label}>
        {loading ? (
          <SkeletonText lines={3} label="Montando a prévia" />
        ) : (
          <>
            <CardHeader titleAs="h3" size="md" title={outlook?.headline ?? (draft.title.trim() || 'Título a definir')} description={structure.join(' · ')} />
            {outlook && outlook.keyLines.length > 0 ? (
              <List label="Falas-chave" framed={false}>
                {outlook.keyLines.map((line) => {
                  const speaker = line.speaker ? bySpeaker.get(line.speaker) : undefined;
                  return (
                    <ListItem
                      key={line.segmentId}
                      density="sm"
                      leading={<Avatar name={speaker?.name ?? line.speaker ?? 'Fala'} src={speaker?.avatarUrl} size="sm" decorative />}
                      title={`“${clipLine(line.text)}”`}
                      description={speaker?.name ?? line.speaker}
                    />
                  );
                })}
              </List>
            ) : null}
            <DescriptionList items={details} labelWidth={88} label="Pauta" />
          </>
        )}
      </Section>
      {speakers.length > 0 ? (
        <Section title="Participantes" meta={formatCount(speakers.length)} titleAs="h2">
          <List label="Participantes" framed={false}>
            {speakers.map((speaker) => (
              <ListItem
                key={speaker.label}
                density="sm"
                leading={<Avatar name={speaker.name} src={speaker.avatarUrl} size="sm" decorative />}
                title={speaker.name}
                description={speakerDetail(speaker)}
              />
            ))}
          </List>
        </Section>
      ) : null}
    </Panel>
  );
}
