'use client';

import { useMemo } from 'react';
import { personLine } from '@/domain';
import type { PersonSummary, SourceAnalysis } from '@/ports';
import { speakerChoice, speakerDisplayName, type NewProductionDraft, type SpeakerChoice } from './form';

/**
 * The speakers of the material as the production will show them (linked person, new name or the
 * raw label), for the "Falantes" count and the default title of the Pauta.
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
