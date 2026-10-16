import { gateForPiece } from './decision.ts';
import type { GateDefinition } from './decision.ts';
import type { IsoDateTime, PersonId } from './ids.ts';
import { PIECE_LABELS } from './piece.ts';
import type { PieceKind } from './piece.ts';
import { activeRun, pendingReview, pieceDecisions, pieceOfKind } from './record.ts';
import type { ProductionRecord } from './record.ts';
import { isDelivered, PIECE_PARENTS, pieceStatus } from './rules/status.ts';
import type { PieceStatus, ProductionStatus } from './rules/status.ts';
import type { GenerationRun } from './run.ts';
import type { ProductionView } from './views.ts';
import { WRITING_FLOW } from './stage.ts';
import { can } from './permissions.ts';
import { hasAnyRole } from './workspace.ts';
import type { Member } from './workspace.ts';
import { decidesOwnRequest } from './rules/decide.ts';

/**
 * Where a production stands, in one newsroom line ("Artigo · Aguardando aprovação de Pedro"),
 * who acts next on it ("Pedro revisa"), and the next step a given person can take on it
 * ("Revisar", "Ajustar", "Criar carrossel"). The line and the next actor are the same for everyone
 * (`ProductionView.situation`); the next step depends on the viewer and is computed by the ports
 * for the acting member.
 */

/** Where a next step lands (routes resolve it: `stepTargetHref`). `structure` is a compatibility target for old article links. */
export type StepTarget =
  | { kind: 'source' }
  | { kind: 'studio'; pieceKind: PieceKind }
  | { kind: 'review'; pieceKind: PieceKind }
  | { kind: 'delivery' }
  | { kind: 'structure' };

export type NextStepKind =
  | 'review'
  | 'adjust'
  | 'retry'
  | 'authorize'
  | 'generate_article'
  | 'continue'
  | 'send'
  | 'resend'
  | 'create_carousel'
  | 'update_carousel'
  | 'deliver'
  | 'open';

/** The verb on the button (COPY §0.3). */
export const NEXT_STEP_LABELS: Record<NextStepKind, string> = {
  review: 'Revisar',
  adjust: 'Ajustar',
  retry: 'Tentar de novo',
  authorize: 'Autorizar',
  generate_article: 'Gerar artigo',
  continue: 'Continuar',
  send: 'Enviar para aprovação',
  resend: 'Reenviar',
  create_carousel: 'Criar carrossel',
  update_carousel: 'Atualizar carrossel',
  deliver: 'Baixar pacote',
  open: 'Abrir',
};

export type NextStep = {
  kind: NextStepKind;
  label: string;
  target: StepTarget;
  /** The viewer's own move (a queue item) rather than a way in ("Abrir"). */
  mine: boolean;
};

export type SituationStage = 'source' | 'article' | 'approval' | 'carousel' | 'delivery' | 'archived';

/**
 * Who moves the production next and with which step, the same for every viewer: the person asked
 * reviews a send (`personId` absent when nobody was named), the last sender adjusts a returned
 * piece, and the owner does everything else (R1: after an approval the owner creates the carousel
 * or downloads the package).
 */
export type NextActor = { personId?: PersonId; step: NextStepKind };

export type Situation = {
  stage: SituationStage;
  pieceKind?: PieceKind;
  /** Badge tone. */
  status: PieceStatus | ProductionStatus;
  /** "Aguardando aprovação de Pedro". */
  text: string;
  /** "Artigo · Aguardando aprovação de Pedro". */
  line: string;
  /** Who has it: the assignee while waiting, the decider after "Pedir ajustes". */
  withPersonId?: PersonId;
  /** Who acts next (none while the AI writes, once delivered and when archived). */
  nextActor?: NextActor;
  /** Parts the AI wrote so far ("parte 2 de 4"). */
  progress?: { current: number; total: number };
};

export type SituationInput = {
  record: ProductionRecord;
  /** Gates of the workspace (default `R1_GATES`): who may review each piece. */
  gates?: readonly GateDefinition[];
  /** The production's read model (its `situation` may still be missing while the view is built). */
  view: Omit<ProductionView, 'situation'>;
  viewer?: Member;
  /** First name for the line ("Pedro"). */
  nameOf: (id: PersonId) => string;
  now: IsoDateTime;
};

/** Parts of an article run ("intro" + "section-k"): `current` = first part not done yet (1-based). */
export function writingParts(run: Pick<GenerationRun, 'steps'>): { current: number; total: number } | undefined {
  const parts = run.steps.filter((step) => step.id === 'intro' || /^section-\d+$/.test(step.id));
  if (parts.length === 0) return undefined;
  const pending = parts.findIndex((step) => step.state !== 'done' && step.state !== 'skipped');
  return { current: pending < 0 ? parts.length : pending + 1, total: parts.length };
}

function situation(stage: SituationStage, kind: PieceKind | undefined, status: Situation['status'], text: string): Situation {
  const head = stage === 'source' ? 'Material' : stage === 'delivery' ? 'Entrega' : kind ? PIECE_LABELS[kind] : '';
  const result: Situation = { stage, status, text, line: head ? `${head} · ${text}` : text };
  if (kind) result.pieceKind = kind;
  return result;
}

/** The planned piece the production is on: the first one not approved yet, in plan order. */
function currentPiece(record: ProductionRecord): { kind: PieceKind; status: PieceStatus } | undefined {
  for (const kind of record.production.plan) {
    const status = pieceStatus(record, kind);
    if (status !== 'approved') return { kind, status };
  }
  return undefined;
}

function pieceSituation(input: SituationInput, kind: PieceKind, status: PieceStatus): Situation {
  const { record, nameOf } = input;
  const piece = pieceOfKind(record, kind);
  const stage: SituationStage = kind === 'carousel' ? 'carousel' : 'article';
  switch (status) {
    case 'generating': {
      const run = piece ? activeRun(record, piece.id) : undefined;
      const progress = run ? writingParts(run) : undefined;
      const result = situation(stage, kind, status, progress ? `A IA está escrevendo (${progress.current} de ${progress.total})` : 'A IA está escrevendo');
      if (progress) result.progress = progress;
      return result;
    }
    case 'failed':
      return situation(stage, kind, status, 'Erro');
    case 'draft':
      return situation(stage, kind, status, 'Rascunho');
    case 'in_review': {
      const request = piece ? pendingReview(record, piece.id) : undefined;
      const assignee = request?.assigneeId;
      const result = situation(kind === 'carousel' ? 'carousel' : 'approval', kind, status, assignee ? `Aguardando aprovação de ${nameOf(assignee)}` : 'Aguardando aprovação');
      if (assignee) result.withPersonId = assignee;
      return result;
    }
    case 'changes_requested': {
      const decisions = piece ? pieceDecisions(record, piece.id) : [];
      const decider = decisions[decisions.length - 1]?.by;
      const result = situation(stage, kind, status, decider ? `Ajustes solicitados por ${nameOf(decider)}` : 'Ajustes solicitados');
      if (decider) result.withPersonId = decider;
      return result;
    }
    case 'approval_outdated':
      return situation(stage, kind, status, 'Aprovação desatualizada');
    case 'stale':
      return situation(stage, kind, status, 'Desatualizado');
    case 'approved':
      return situation(stage, kind, status, 'Aprovado');
    case 'not_started':
    case 'locked': {
      // A derivative not created yet after its parent's approval reads as the parent's state
      // ("Artigo · Aprovado"), since that is what was last done.
      const parent = (PIECE_PARENTS[kind] ?? []).find((entry) => record.production.plan.includes(entry));
      if (parent && pieceStatus(record, parent) === 'approved') return { ...situation(stage, parent, 'approved', 'Aprovado'), stage };
      return situation(stage, kind, status, 'Não iniciado');
    }
  }
}

/** Whoever sent the piece last (a withdrawn send does not count): they adjust it when it comes back. */
function lastSender(record: ProductionRecord, pieceId: string | undefined): PersonId | undefined {
  if (!pieceId) return undefined;
  const requests = record.reviewRequests.filter((entry) => entry.subject.pieceId === pieceId && entry.withdrawnAt === undefined);
  return requests.sort((a, b) => Date.parse(a.requestedAt) - Date.parse(b.requestedAt)).pop()?.requestedBy;
}

/** Who acts next on the planned piece the production is on (see `NextActor`). */
function pieceNextActor(record: ProductionRecord, kind: PieceKind, status: PieceStatus): NextActor | undefined {
  const owner = record.production.ownerId;
  const piece = pieceOfKind(record, kind);
  switch (status) {
    case 'generating':
    case 'locked':
    case 'approved':
      return undefined;
    case 'failed':
      return { personId: owner, step: 'retry' };
    case 'not_started':
      if (kind === 'article') return { personId: owner, step: record.production.flowId === WRITING_FLOW.id ? 'continue' : 'generate_article' };
      return { personId: owner, step: kind === 'carousel' ? 'create_carousel' : 'continue' };
    case 'draft':
      return { personId: owner, step: 'continue' };
    case 'in_review': {
      const assignee = piece ? pendingReview(record, piece.id)?.assigneeId : undefined;
      return assignee ? { personId: assignee, step: 'review' } : { step: 'review' };
    }
    case 'changes_requested':
      return { personId: lastSender(record, piece?.id) ?? owner, step: 'adjust' };
    case 'approval_outdated':
      return { personId: owner, step: 'resend' };
    case 'stale':
      return { personId: owner, step: kind === 'carousel' ? 'update_carousel' : 'continue' };
  }
}

function withNextActor(result: Situation, actor: NextActor | undefined): Situation {
  if (actor) result.nextActor = actor;
  return result;
}

/** One line for lists, the Início queue and the Equipe tab, with who acts next (viewer-independent). */
export function situationOf(input: SituationInput): Situation {
  const { record, view } = input;
  const owner = record.production.ownerId;
  if (view.status === 'archived') return situation('archived', undefined, 'archived', 'Arquivada');
  if (view.status === 'unauthorized') return withNextActor(situation('source', undefined, 'unauthorized', 'Falta autorização'), { personId: owner, step: 'authorize' });
  const current = currentPiece(record);
  if (current) return withNextActor(pieceSituation(input, current.kind, current.status), pieceNextActor(record, current.kind, current.status));
  return isDelivered(record)
    ? situation('delivery', undefined, 'completed', 'Concluída')
    : withNextActor(situation('delivery', undefined, 'approved', 'Pronto para baixar'), { personId: owner, step: 'deliver' });
}

function step(kind: NextStepKind, target: StepTarget, mine: boolean): NextStep {
  return { kind, label: NEXT_STEP_LABELS[kind], target, mine };
}

/** Where "Abrir" lands for the production's current state. */
function openTarget(situation: Situation): StepTarget {
  if (situation.stage === 'source') return { kind: 'source' };
  if (situation.stage === 'delivery') return { kind: 'delivery' };
  return { kind: 'studio', pieceKind: situation.pieceKind ?? 'article' };
}

/**
 * The next step the viewer can take (null: nothing for them to do, e.g. waiting for someone else).
 * Viewer rules (CONTRACT §2.2): a member with the gate's role who did not send it reviews; the
 * owner or an editor adjusts a returned text; the owner or an admin retries a failed generation and
 * authorises the material; editors continue drafts, resend edited approvals, create and update the
 * carousel and download the package. Every move that writes also needs the role's capability
 * (`can`): an approver who owns a production only opens it. `mine` marks the viewer's own move
 * (their queue), not a way in.
 */
export function nextStepFor(input: SituationInput): NextStep | null {
  const { record, viewer } = input;
  if (!viewer) return null;
  const situation = situationOf(input);
  const open = step('open', openTarget(situation), false);
  if (situation.stage === 'archived') return open;
  const owner = record.production.ownerId === viewer.personId;
  const admin = hasAnyRole(viewer, ['admin']);
  const editor = can(viewer, 'piece.edit');
  if (situation.status === 'unauthorized') return (owner || admin) && can(viewer, 'production.edit') ? step('authorize', { kind: 'source' }, owner) : open;

  const current = currentPiece(record);
  if (!current) {
    if (isDelivered(record)) return open;
    return can(viewer, 'delivery.record') ? step('deliver', { kind: 'delivery' }, owner) : open;
  }
  const { kind, status } = current;
  const piece = pieceOfKind(record, kind);
  const studio: StepTarget = { kind: 'studio', pieceKind: kind };
  switch (status) {
    case 'generating':
    case 'locked':
      return open;
    case 'failed':
      return (owner || admin) && editor ? step('retry', studio, true) : open;
    case 'not_started':
      if (!editor) return open;
      if (kind === 'article') return record.production.flowId === WRITING_FLOW.id
        ? step('continue', studio, owner)
        : step('generate_article', studio, owner);
      return step(kind === 'carousel' ? 'create_carousel' : 'continue', studio, owner);
    case 'draft':
      return editor ? step('continue', studio, owner) : open;
    case 'in_review': {
      const request = piece ? pendingReview(record, piece.id) : undefined;
      if (request?.requestedBy === viewer.personId && !decidesOwnRequest(viewer, request) || (owner && !request)) return null;
      const gate = gateForPiece(kind, input.gates);
      if (gate && hasAnyRole(viewer, gate.roles)) {
        return step('review', { kind: 'review', pieceKind: kind }, request?.assigneeId === undefined || request.assigneeId === viewer.personId);
      }
      return owner ? null : open;
    }
    case 'changes_requested': {
      if (!editor) return open;
      return step('adjust', studio, owner || lastSender(record, piece?.id) === viewer.personId);
    }
    case 'approval_outdated':
      return editor ? step('resend', studio, owner) : open;
    case 'stale':
      if (!editor) return open;
      return step(kind === 'carousel' ? 'update_carousel' : 'continue', studio, owner);
    case 'approved':
      return open;
  }
}
