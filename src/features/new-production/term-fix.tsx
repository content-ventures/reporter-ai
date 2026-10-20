'use client';

import { useMemo, useState } from 'react';
import { Alert, ControlButton, Disclosure, Field, FieldGroup, Grid, Input, TranscriptViewer, type TranscriptSegment } from '@content-ventures/design-system/v3';
import { ArrowLeftRight } from '@content-ventures/design-system/v3/icons';
import { termOccurrences, type TermCorrection } from '@/domain/text/terms';
import { parseTranscript } from '@/domain/text/transcript-parse';

/**
 * "Corrigir termo" (Material): the reporter reads the transcript and writes a name the transcription
 * misheard ("Q Show") the right way ("Aquishow") before the production exists, so the AI writes from
 * the right name. Replacing whole words only; the speech, the times and the speakers stay the same.
 */
export function TermFix({ text, onReplace }: {
  text: string;
  /** Replaces `from` by `to` across the material, unless it would change who speaks or the times. */
  onReplace: (from: string, to: string) => TermCorrection;
}) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [query, setQuery] = useState('');
  const [done, setDone] = useState<{ tone: 'success' | 'warning'; text: string } | null>(null);
  const count = from.trim() ? termOccurrences(text, from) : 0;
  const ready = count > 0 && Boolean(to.trim());
  // Read from the text on screen, so a replacement shows at once, before the material is analyzed again.
  const viewer = useMemo<TranscriptSegment[]>(() => parseTranscript(text).segments.map((segment) => ({
    id: segment.id, text: segment.text,
    ...(segment.speaker ? { speaker: { id: segment.speaker, name: segment.speaker } } : {}),
    ...(segment.startMs !== undefined ? { start: segment.startMs } : {}),
    ...(segment.endMs !== undefined ? { end: segment.endMs } : {}),
  })), [text]);

  const replace = () => {
    const result = onReplace(from, to);
    if (result.refused) {
      setDone({ tone: 'warning', text: `Essa troca mudaria quem fala ou os horários do material. Corrija o nome de quem fala em Falantes.` });
      return;
    }
    if (!result.count) return;
    setDone({ tone: 'success', text: `${result.count} ${result.count === 1 ? 'troca' : 'trocas'}: ${from.trim()} → ${to.trim()}` });
    setFrom('');
    setTo('');
  };

  return (
    <FieldGroup label="Nomes que a transcrição errou" columns={1}>
      <Grid columns="1:1" collapseBelow={480}>
        <Field label="Trocar" meta={from.trim() ? `${count} ${count === 1 ? 'ocorrência' : 'ocorrências'}` : undefined}>
          {(props) => <Input id={props.id} aria-describedby={props.describedBy} value={from} placeholder="Ex.: Q Show" onChange={(event) => setFrom(event.target.value)} />}
        </Field>
        <Field label="Por">
          {(props) => <Input id={props.id} aria-describedby={props.describedBy} value={to} placeholder="Ex.: Aquishow"
            onChange={(event) => setTo(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && ready) { event.preventDefault(); replace(); } }}
            trailing={<ControlButton label={count === 1 ? 'Trocar 1 ocorrência' : `Trocar ${count} ocorrências`} icon={ArrowLeftRight} disabled={!ready} onClick={replace} />} />}
        </Field>
      </Grid>
      {done ? <Alert compact tone={done.tone} onDismiss={() => setDone(null)} dismissLabel="Fechar">{done.text}</Alert> : null}
      <Disclosure summary="Ver transcrição">
        <TranscriptViewer label="Transcrição" segments={viewer} query={query} onQueryChange={setQuery} height={360} empty="Material sem falas" />
      </Disclosure>
    </FieldGroup>
  );
}
