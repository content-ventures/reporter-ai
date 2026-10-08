'use client';

import {
  ButtonLink,
  CardHeader,
  EmptyState,
  MeterList,
  Panel,
  Section,
  SkeletonText,
  StepPipeline,
  type MeterItem,
  type PipelineStage,
} from '@content-ventures/design-system/v3';
import { ArrowRight, Plus, PenLine } from '@content-ventures/design-system/v3/icons';
import { PIECE_LABELS, PIECE_STATUS_LABELS, type CheckResult, type PieceStatus, type ProductionView, type StageView } from '@/domain';
import type { OverviewData } from '@/ports';
import { SOURCE_ORIGIN_LABELS } from '@/registries';
import { formatShortDate, plural } from '@/ui/format';
import { NEW_PRODUCTION_HREF, reviewHref, stageHref } from '@/ui/routes';
import { StatusBadge } from '@/ui/status-badge';
import { useNow, useRelativeTime } from '@/ui/time';

/**
 * "Continue de onde parou" (PLAN §3.1): the viewer's most recent open production, its journey
 * (display only) and the readiness of the piece it is on — citações conferidas, blocos da IA
 * revisados, extensão no alvo — with the one next action as the primary button.
 */

const PIPELINE_STATE: Record<StageView['state'], PipelineStage['state']> = {
  done: 'done',
  current: 'current',
  upcoming: 'upcoming',
  blocked: 'upcoming',
  warn: 'upcoming',
  error: 'error',
};

const sentence = (text: string) => text.replace(/\.$/, '');

function stageDetail(stage: StageView, production: ProductionView): string | undefined {
  if (stage.state === 'blocked' && stage.blockedReason) return sentence(stage.blockedReason);
  if (stage.kind === 'source') return stage.status === 'ready' ? 'Autorizado' : 'Falta autorizar';
  if (stage.kind === 'delivery') return stage.status === 'completed' ? 'Concluída' : stage.status === 'ready' ? 'Pronta para exportar' : undefined;
  const status = PIECE_STATUS_LABELS[stage.status as PieceStatus];
  const piece = production.pieces.find((entry) => entry.kind === stage.pieceKind);
  if (stage.state === 'current' && piece && piece.draft.words > 0 && piece.kind === 'article') {
    return `${status} · ${plural(piece.draft.words, 'palavra', 'palavras')}`;
  }
  return status;
}

export function journeyStages(production: ProductionView): PipelineStage[] {
  return production.stages.map((stage) => {
    const item: PipelineStage = { id: stage.id, label: stage.label, state: PIPELINE_STATE[stage.state] };
    const detail = stageDetail(stage, production);
    if (detail) item.detail = detail;
    return item;
  });
}

/** Where the next action happens and its verb ("Continuar artigo", "Aprovar artigo"…). */
export function nextStep(production: ProductionView): { href: string; label: string } {
  const action = production.nextAction;
  const stage = production.stages.find((entry) => entry.id === action.stageId);
  const href =
    action.kind === 'review' && action.pieceKind
      ? reviewHref(production.id, action.pieceKind)
      : stage
        ? stageHref(production.id, stage)
        : stageHref(production.id, { kind: 'source' });
  if (action.kind === 'wait') {
    return { href, label: action.pieceKind ? `Abrir ${PIECE_LABELS[action.pieceKind].toLowerCase()}` : 'Abrir produção' };
  }
  if (action.kind === 'done') return { href, label: 'Abrir entrega' };
  return { href, label: action.label };
}

/** "Entrevista · 4 out · 3 falantes". */
function productionFacts(production: ProductionView, now: Date | undefined): string[] {
  const source = production.sources[0];
  if (!source) return [];
  const origin = [SOURCE_ORIGIN_LABELS[source.origin], source.recordedOn ? formatShortDate(source.recordedOn, now ?? new Date(source.recordedOn)) : null].filter(Boolean).join(' · ');
  const speakers = source.speakers.length;
  return [origin, speakers > 0 ? plural(speakers, 'falante', 'falantes') : ''].filter(Boolean);
}

const READINESS_ORDER = ['article.quotes', 'article.ai-reviewed', 'article.length', 'carousel.limits', 'carousel.sequence'];

/**
 * Readiness is a quantity, not a status: one neutral bar everywhere (status tones would read as
 * "Aprovado"/"Desatualizado"). Only a check that blocks the approval turns red.
 */
const METER_COLOR: Record<CheckResult['status'], MeterItem['color']> = {
  pass: 'neutral',
  warn: 'neutral',
  fail: 'neutral',
  na: 'neutral',
  info: 'neutral',
};

/** Checks with a measurable progress, as meters: "Citações conferidas · 67% · 2 de 3 conferidas". */
export function readinessMeters(checks: readonly CheckResult[]): MeterItem[] {
  return checks
    .filter((check) => check.progress && check.progress.total > 0 && check.status !== 'na')
    .sort((a, b) => {
      const rank = (id: string) => (READINESS_ORDER.includes(id) ? READINESS_ORDER.indexOf(id) : READINESS_ORDER.length);
      return rank(a.id) - rank(b.id);
    })
    .map((check) => {
      const progress = check.progress as { current: number; total: number };
      const item: MeterItem = {
        key: check.id,
        label: check.label,
        value: Math.min(100, (progress.current / progress.total) * 100),
        share: Math.min(100, (progress.current / progress.total) * 100),
        color: check.status === 'fail' && check.blocking ? 'red' : METER_COLOR[check.status],
      };
      if (check.detail) item.caption = check.detail;
      return item;
    });
}

const percent = (value: number) => `${Math.round(value)}%`;

function ContinueDetails({ production, readiness }: { production: ProductionView; readiness: OverviewData['continueReadiness'] }) {
  const edited = useRelativeTime(production.updatedAt);
  const facts = productionFacts(production, useNow());
  const description = [...facts, edited ? `editada ${edited}` : ''].filter(Boolean).join(' · ');
  const stage = production.stages.find((entry) => entry.id === production.currentStageId);
  const meters = readiness && stage?.kind === 'piece' ? readinessMeters(readiness.checks) : [];
  const next = nextStep(production);

  return (
    <Panel>
      <Section
        title="Continue de onde parou"
        action={
          <ButtonLink href={next.href} variant="primary" size="sm" trailingIcon={ArrowRight}>
            {next.label}
          </ButtonLink>
        }
      >
        <CardHeader
          title={production.title}
          titleAs="h3"
          size="md"
          badge={<StatusBadge kind="production" status={production.status} size="sm" />}
          description={description || undefined}
          divided
        />
        <StepPipeline variant="journey" label={`Etapas de ${production.title}`} stages={journeyStages(production)} />
      </Section>
      {readiness && meters.length > 0 && (
        <Section title="Prontidão" meta={`${readiness.readiness.passed} de ${readiness.readiness.total} checagens`}>
          <MeterList label={`Prontidão do ${PIECE_LABELS[readiness.pieceKind].toLowerCase()}`} items={meters} format={percent} shares={false} />
        </Section>
      )}
    </Panel>
  );
}

export function ContinuePanel({ data, loading }: { data: OverviewData | undefined; loading: boolean }) {
  if (loading || !data) {
    return (
      <Panel>
        <Section title="Continue de onde parou">
          <SkeletonText lines={4} label="Carregando a última produção" />
        </Section>
        <Section title="Prontidão">
          <SkeletonText lines={3} lastWidth="40%" label="Carregando a prontidão" />
        </Section>
      </Panel>
    );
  }
  if (!data.continueWith) {
    return (
      <Panel>
        <Section title="Continue de onde parou">
          <EmptyState
            icon={PenLine}
            size="panel"
            title="Nenhuma produção aberta com você"
            actions={
              <ButtonLink href={NEW_PRODUCTION_HREF} icon={Plus} size="sm">
                Criar produção
              </ButtonLink>
            }
          />
        </Section>
      </Panel>
    );
  }
  return <ContinueDetails production={data.continueWith} readiness={data.continueReadiness} />;
}
