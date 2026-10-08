import type { ActivityEvent } from '../../../domain/activity.ts';
import type { AuditAction, AuditChange, AuditEvent, AuditResult, AuditTarget } from '../../../domain/audit.ts';
import type { PieceId } from '../../../domain/ids.ts';
import { PIECE_LABELS } from '../../../domain/piece.ts';
import type { PieceKind } from '../../../domain/piece.ts';

/**
 * The audit view of the semantic activity feed: CRUD of productions, transcripts and pieces,
 * generation results, review steps and exports. Run starts, assistant runs, AI suggestions and
 * pilot feedback stay out (they are work in progress, not changes to a record).
 */

export type ActivityLookup = {
  /** Kind of a piece that still exists in the workspace. */
  pieceKind(pieceId: PieceId): PieceKind | undefined;
};

type Mapped = { action: AuditAction; result?: AuditResult; target?: AuditTarget; changes?: AuditChange[]; reason?: string };

const GENERATION_RUNS: Record<string, PieceKind> = { 'article.generate': 'article', 'carousel.generate': 'carousel' };

/** `data.piece` is a kind in live events and a label ("Artigo") in fixture-derived ones. */
function kindFromData(data: ActivityEvent['data']): PieceKind | undefined {
  const piece = data?.piece;
  if (typeof piece !== 'string') return undefined;
  if (piece in PIECE_LABELS) return piece as PieceKind;
  const byLabel = (Object.entries(PIECE_LABELS) as [PieceKind, string][]).find(([, label]) => label === piece);
  return byLabel?.[0];
}

function pieceKindOf(event: ActivityEvent, lookup: ActivityLookup): PieceKind | undefined {
  const subject = event.subject;
  const fromSubject = subject?.kind === 'version' ? lookup.pieceKind(subject.pieceId) : undefined;
  return fromSubject ?? kindFromData(event.data);
}

function text(data: ActivityEvent['data'], key: string): string | undefined {
  const value = data?.[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function number(data: ActivityEvent['data'], key: string): number | undefined {
  const value = data?.[key];
  return typeof value === 'number' ? value : undefined;
}

function productionTarget(event: ActivityEvent): AuditTarget | undefined {
  if (!event.productionId) return undefined;
  return { kind: 'production', id: event.productionId, label: text(event.data, 'title') ?? 'Produção', productionId: event.productionId };
}

function sourceTarget(event: ActivityEvent): AuditTarget | undefined {
  const subject = event.subject;
  if (subject?.kind !== 'source-version' && subject?.kind !== 'source') return productionTarget(event);
  const target: AuditTarget = { kind: 'source', id: subject.sourceId, label: text(event.data, 'title') ?? 'Transcrição' };
  if (event.productionId) target.productionId = event.productionId;
  return target;
}

function versionTarget(event: ActivityEvent, kind: PieceKind): AuditTarget | undefined {
  const subject = event.subject;
  const base = event.productionId ? { productionId: event.productionId, pieceKind: kind } : { pieceKind: kind };
  if (subject?.kind === 'version') return { kind: 'version', id: subject.versionId, label: `${PIECE_LABELS[kind]} v${subject.number}`, ...base };
  const versionNumber = number(event.data, 'number');
  return { kind: 'piece', id: event.productionId ?? event.id, label: versionNumber ? `${PIECE_LABELS[kind]} v${versionNumber}` : PIECE_LABELS[kind], ...base };
}

function mapActivity(event: ActivityEvent, lookup: ActivityLookup): Mapped | undefined {
  switch (event.type) {
    case 'production.created':
      return { action: 'production.created', target: productionTarget(event) };
    case 'production.archived':
      return { action: 'production.archived', target: productionTarget(event) };
    case 'source.added':
      return { action: 'source.created', target: sourceTarget(event) };
    case 'source.revised': {
      const version = number(event.data, 'number');
      const changes = version && version > 1 ? [{ field: 'Versão do material', before: `v${version - 1}`, after: `v${version}` }] : undefined;
      return { action: 'source.updated', target: sourceTarget(event), changes };
    }
    case 'source.authorized':
      return { action: 'source.authorized', target: sourceTarget(event) };
    case 'run.completed':
    case 'run.failed': {
      const runKind = text(event.data, 'runKind');
      const kind = runKind ? GENERATION_RUNS[runKind] : kindFromData(event.data);
      if (!kind) return undefined;
      const failed = event.type === 'run.failed';
      return {
        action: kind === 'carousel' ? 'carousel.generated' : 'article.generated',
        result: failed ? 'failure' : 'success',
        target: versionTarget(event, kind),
        reason: failed ? (text(event.data, 'error') ?? 'A geração parou antes de terminar.') : undefined,
      };
    }
    case 'version.created':
    case 'version.restored': {
      if (event.type === 'version.created' && event.data?.origin === 'generation') return undefined;
      const kind = pieceKindOf(event, lookup);
      if (kind !== 'article' && kind !== 'carousel') return undefined;
      const restored = event.type === 'version.restored';
      const from = number(event.data, 'from');
      const to = number(event.data, 'number');
      return {
        action: restored ? (kind === 'carousel' ? 'carousel.restored' : 'article.restored') : kind === 'carousel' ? 'carousel.updated' : 'article.updated',
        target: versionTarget(event, kind),
        changes: restored && from && to ? [{ field: 'Versão', before: `v${from}`, after: `v${to}` }] : undefined,
      };
    }
    case 'review.requested': {
      const kind = pieceKindOf(event, lookup) ?? 'article';
      return { action: 'review.requested', target: versionTarget(event, kind) };
    }
    case 'decision.recorded': {
      const kind = pieceKindOf(event, lookup) ?? 'article';
      return { action: event.data?.decision === 'approved' ? 'review.approved' : 'review.returned', target: versionTarget(event, kind) };
    }
    case 'delivery.completed':
    case 'delivery.failed': {
      const files = number(event.data, 'files');
      const target: AuditTarget = {
        kind: 'package',
        id: `pkg-${event.id}`,
        label: files ? `Pacote · ${files} ${files === 1 ? 'arquivo' : 'arquivos'}` : 'Pacote de entrega',
      };
      if (event.productionId) target.productionId = event.productionId;
      const failed = event.type === 'delivery.failed';
      return { action: 'package.exported', result: failed ? 'failure' : 'success', target, reason: failed ? 'A exportação do pacote falhou.' : undefined };
    }
    default:
      return undefined;
  }
}

/** One audit entry per auditable activity event (`aud-a-<activity id>`), or `undefined`. */
export function auditFromActivity(event: ActivityEvent, lookup: ActivityLookup): AuditEvent | undefined {
  const mapped = mapActivity(event, lookup);
  if (!mapped) return undefined;
  const entry: AuditEvent = {
    id: `aud-a-${event.id}`,
    workspaceId: event.workspaceId,
    at: event.at,
    actorId: event.actorId,
    action: mapped.action,
    result: mapped.result ?? 'success',
    origin: { channel: event.type.startsWith('run.') ? 'system' : 'web' },
    requestId: `req-${event.id}`,
    activityId: event.id,
  };
  if (mapped.target) entry.target = mapped.target;
  if (mapped.changes) entry.changes = mapped.changes;
  if (mapped.reason) entry.reason = mapped.reason;
  return entry;
}
