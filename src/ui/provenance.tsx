'use client';

import {
  DescriptionList,
  LinkButton,
  MetaList,
  Popover,
  PopoverHeader,
  type DescriptionItem,
} from '@content-ventures/design-system/v3';
import { formatTimestamp, shortHash, type GenerationRun, type Ref } from '@/domain';
import { formatCount, formatDuration, plural } from './format';

/**
 * Where an AI output came from (REQ-1.2, REQ-T.4): one quiet line — model ("Simulação local") ·
 * duration · "Ver detalhes" — with the full record (prompt key/version, inputs, hashes, output
 * version, usage) one click away in a Popover (works on touch, unlike a HoverCard). Usage and
 * cost appear only when the adapter reports them — the simulation never invents them.
 */

export type ProvenanceRun = Pick<GenerationRun, 'prompt' | 'model' | 'inputs' | 'startedAt' | 'endedAt'> &
  Partial<Pick<GenerationRun, 'output' | 'usage' | 'cost'>> & { durationMs?: number };

/** Readable label of any reference: "Material v1 · #a1b2c3", "Pauta rev. 2", "v4 · #9f0e1d". */
export function describeRef(ref: Ref): string {
  switch (ref.kind) {
    case 'version':
      return `v${ref.number} · #${shortHash(ref.hash)}`;
    case 'source-version':
      return `Material v${ref.sourceVersion} · #${shortHash(ref.hash)}`;
    case 'brief':
      return `Pauta rev. ${ref.revision}`;
    case 'asset':
      return `Ativo ${ref.assetId}`;
    case 'source': {
      const { locator } = ref;
      if (locator.type === 'segment') return `Trecho ${locator.segmentId}`;
      if (locator.type === 'url') return safeHost(locator.url);
      if (locator.type === 'quote') return `Citação ${locator.quoteId}`;
      return `Mídia ${formatTimestamp(locator.startMs)}–${formatTimestamp(locator.endMs)}`;
    }
  }
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Inputs grouped for one line: whole references by name, segment references counted. */
export function summarizeInputs(inputs: readonly Ref[], describe: (ref: Ref) => string = describeRef): string[] {
  const named = inputs.filter((ref) => ref.kind !== 'source').map(describe);
  const excerpts = inputs.filter((ref) => ref.kind === 'source').length;
  return excerpts > 0 ? [...named, plural(excerpts, 'trecho', 'trechos')] : named;
}

function runMs(run: ProvenanceRun): number | undefined {
  if (run.durationMs !== undefined) return run.durationMs;
  if (!run.startedAt || !run.endedAt) return undefined;
  return Date.parse(run.endedAt) - Date.parse(run.startedAt);
}

export type ProvenanceProps = {
  run: ProvenanceRun;
  /** Names references with screen knowledge (source titles, piece labels). Default: `describeRef`. */
  describe?: (ref: Ref) => string;
  /** MetaList size: `xs` under a card, `sm` in panels. */
  size?: 'xs' | 'sm' | 'md';
  /** "Detalhes" opens the full record. Default true. */
  details?: boolean;
};

export function Provenance({ run, describe = describeRef, size = 'xs', details = true }: ProvenanceProps) {
  const duration = runMs(run);
  const inputs = summarizeInputs(run.inputs, describe);
  const items: DescriptionItem[] = [
    { label: 'Modelo', value: run.model.label },
    { label: 'Prompt', value: `${run.prompt.key} · v${run.prompt.version}`, copy: run.prompt.hash, hint: `#${shortHash(run.prompt.hash)}` },
    { label: 'Duração', value: formatDuration(duration), numeric: true },
    { label: 'Entradas', value: inputs.length > 0 ? <MetaList items={inputs} size="sm" /> : undefined, state: inputs.length > 0 ? undefined : 'empty' },
  ];
  if (run.output) items.push({ label: 'Saída', value: describe(run.output), copy: run.output.hash, numeric: true });
  if (run.usage?.totalTokens !== undefined) items.push({ label: 'Uso', value: `${formatCount(run.usage.totalTokens)} tokens`, numeric: true });
  if (run.cost) items.push({ label: 'Custo', value: `US$ ${run.cost.usd.toFixed(4).replace('.', ',')}`, numeric: true });

  const meta = [run.model.label, duration !== undefined ? { value: formatDuration(duration), numeric: true } : null];

  return (
    <MetaList
      size={size}
      label="Proveniência"
      items={[
        ...meta,
        details ? (
          <Popover
            key="details"
            label="Proveniência"
            width={360}
            trigger={(props) => (
              <LinkButton {...props} tone="quiet" size="inherit">
                Ver detalhes
              </LinkButton>
            )}
          >
            <PopoverHeader title="Proveniência" meta={run.model.label} />
            <DescriptionList items={items} labelWidth={88} label="Proveniência da geração" />
          </Popover>
        ) : null,
      ]}
    />
  );
}
