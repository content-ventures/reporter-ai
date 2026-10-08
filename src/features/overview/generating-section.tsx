'use client';

import { useState } from 'react';
import { EmptyState, Section, SkeletonText, TextLink, Timeline, type TimelineEntry } from '@content-ventures/design-system/v3';
import { Sparkles } from '@content-ventures/design-system/v3/icons';
import {
  RUN_KIND_LABELS,
  type ActivityType,
  type GenerationRun,
  type PieceKind,
  type ProductionId,
  type RunFold,
  type RunId,
  type RunKind,
} from '@/domain';
import type { OverviewData, RunUpdate } from '@/ports';
import { useProduction, useRun, useRunOutcomes } from '@/state';
import { formatCount, plural } from '@/ui/format';
import { PersonAvatar } from '@/ui/person-avatar';
import { Provenance } from '@/ui/provenance';
import { pieceHref } from '@/ui/routes';
import { RunTrace } from '@/ui/run-trace';
import { RelativeTime } from '@/ui/time';
import { liveExcerpt } from './overview-format';

/**
 * "Gerando agora" (PLAN §3.1, M5 brought into R1): the generations running in the workspace,
 * wherever they were started. Always compact — one entry per run: who started it, the
 * production, the DS AgentTrace line (current step · k/n · "Abrir") and the newest words being
 * written on one line under it.
 * With nothing running, "Última geração" is the same entry for the run that just ended on this
 * page, else the workspace's latest, with its provenance under it (wraps, never cut).
 * A section, not a panel: it shares the panel of "Aguardando você" (`OverviewScreen`).
 */

const MAX_LIVE = 4;
const MAX_FINISHED = 3;
/** Characters of the live excerpt; the DS line cuts it at the start, so the newest words stay in view. */
const EXCERPT_CHARS = 110;

type PanelRun = {
  runId: RunId;
  productionId: ProductionId;
  productionTitle: string;
  run: GenerationRun;
  live: boolean;
  /** Excerpt shown while this session has no written words of the run (current step detail). */
  fallback?: string;
};

function pieceKindOf(kind: RunKind): PieceKind {
  return kind.startsWith('carousel') ? 'carousel' : 'article';
}

/** The newest written words, else the outline, else the title the run produced. */
function foldExcerpt(fold: RunFold): string | undefined {
  const written = [...fold.blocks].reverse().find((block) => block.text.trim().length > 0);
  if (written) return liveExcerpt(written.text, EXCERPT_CHARS);
  if (fold.outline.length > 0) return liveExcerpt(fold.outline.map((section) => section.title).join(' · '), EXCERPT_CHARS);
  return fold.title;
}

/** "Concluída · 8 etapas" (the duration is in the provenance line under it). */
function finishedSummary(run: GenerationRun): string | undefined {
  if (run.status !== 'completed') return undefined;
  return `Concluída · ${plural(run.steps.filter((step) => step.state === 'done').length, 'etapa', 'etapas')}`;
}

/** The compact trace of one run, live from this session's fold when it is running here. */
function RunLine({ entry }: { entry: PanelRun }) {
  const state = useRun(entry.live ? entry.runId : null);
  const fold = state.status === 'ready' ? state.data.fold : undefined;
  const run = fold?.run ?? entry.run;
  const preview = entry.live ? ((fold ? foldExcerpt(fold) : undefined) ?? entry.fallback) : undefined;
  return (
    <RunTrace
      run={run}
      variant="compact"
      announce={false}
      label={RUN_KIND_LABELS[run.kind]}
      summary={finishedSummary(run)}
      preview={preview}
      action={
        <TextLink size="sm" href={pieceHref(entry.productionId, pieceKindOf(run.kind))} aria-label={`Abrir ${entry.productionTitle}`}>
          Abrir
        </TextLink>
      }
    />
  );
}

/** "Simulação local · 44 s · Ver detalhes". */
function RunProvenance({ entry }: { entry: PanelRun }) {
  return <Provenance run={entry.run} size="xs" />;
}

function runEntry(entry: PanelRun): TimelineEntry {
  const at = entry.live ? (entry.run.startedAt ?? entry.run.createdAt) : (entry.run.endedAt ?? entry.run.startedAt ?? entry.run.createdAt);
  const item: TimelineEntry = {
    id: entry.runId,
    marker: <PersonAvatar personId={entry.run.createdBy} size="xs" decorative />,
    title: entry.productionTitle,
    date: <RelativeTime at={at} />,
    dateTime: at,
    description: <RunLine entry={entry} />,
  };
  if (!entry.live) item.extra = <RunProvenance entry={entry} />;
  return item;
}

function RunList({ label, entries }: { label: string; entries: PanelRun[] }) {
  return <Timeline label={label} variant="activity" items={entries.map(runEntry)} />;
}

const RUN_ENDINGS: readonly ActivityType[] = ['run.completed', 'run.failed', 'run.cancelled'];

/** The workspace's last finished generation, read from its production. */
function LastRun({ productionId }: { productionId: ProductionId }) {
  const production = useProduction(productionId);
  if (production.status === 'loading') return <SkeletonText lines={2} label="Carregando a última geração" />;
  if (production.status === 'error') return null;
  const detail = production.data;
  const run = detail.runs
    .filter((entry) => !entry.parentRunId && entry.endedAt && entry.kind.endsWith('.generate'))
    .sort((a, b) => Date.parse(b.endedAt ?? '') - Date.parse(a.endedAt ?? ''))[0];
  if (!run) return <EmptyState icon={Sparkles} size="inline" title="Nenhuma geração ainda" />;
  return <RunList label="Última geração" entries={[{ runId: run.id, productionId: detail.id, productionTitle: detail.title, run, live: false }]} />;
}

/** What the current step reports ("98 falas · 3 falantes"), never its name (already on the line). */
function currentDetail(run: OverviewData['activeRuns'][number]): string | undefined {
  return run.current?.meta;
}

export function GeneratingSection({ data, loading }: { data: OverviewData | undefined; loading: boolean }) {
  const active = data?.activeRuns;
  const [finished, setFinished] = useState<PanelRun[]>([]);

  useRunOutcomes((update: RunUpdate) => {
    // Only whole generations (article, carousel copy), not the copilot's small actions.
    if (update.meta.child || !update.fold.run.kind.endsWith('.generate')) return;
    const known = active?.find((run) => run.id === update.meta.runId);
    const entry: PanelRun = {
      runId: update.meta.runId,
      productionId: update.meta.productionId,
      productionTitle: known?.productionTitle ?? update.meta.label,
      run: update.fold.run,
      live: false,
    };
    setFinished((previous) => [entry, ...previous.filter((item) => item.runId !== entry.runId)].slice(0, MAX_FINISHED));
  });

  if (loading || !active) {
    return (
      <Section title="Gerando agora">
        <SkeletonText lines={2} label="Carregando as gerações" />
      </Section>
    );
  }

  const live: PanelRun[] = active.slice(0, MAX_LIVE).map((run) => {
    const entry: PanelRun = { runId: run.id, productionId: run.productionId, productionTitle: run.productionTitle, run, live: true };
    const detail = currentDetail(run);
    if (detail) entry.fallback = liveExcerpt(detail, EXCERPT_CHARS);
    return entry;
  });
  if (live.length > 0) {
    return (
      <Section title="Gerando agora" meta={formatCount(active.length)}>
        <RunList label="Gerações em andamento" entries={live} />
      </Section>
    );
  }

  // Nothing running: the run that just ended here, else the workspace's last finished one.
  const ended = finished.find((entry) => !active.some((run) => run.id === entry.runId));
  const lastEnded = ended
    ? undefined
    : data?.activity.find((item) => item.productionId && RUN_ENDINGS.includes(item.type) && String(item.data?.runKind ?? '').endsWith('.generate'));
  return (
    <Section title="Última geração">
      {ended ? (
        <RunList label="Última geração" entries={[ended]} />
      ) : lastEnded?.productionId ? (
        <LastRun productionId={lastEnded.productionId} />
      ) : (
        <EmptyState icon={Sparkles} size="inline" title="Nenhuma geração ainda" />
      )}
    </Section>
  );
}
