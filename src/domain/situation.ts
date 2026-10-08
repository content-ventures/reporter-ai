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
import { hasAnyRole } from './workspace.ts';
import type { Member } from './workspace.ts';

/**
 * Where a production stands, in one newsroom line ("Artigo · Aguardando aprovação de Pedro"),
 * and the next step a given person can take on it ("Revisar", "Ajustar", "Criar carrossel").
 * The line is the same for everyone (`ProductionView.situation`); the next step depends on the
 * viewer and is computed by the ports for the acting member.
 */

/** Where a next step lands (routes resolve it: `stepTargetHref`). `structure` = Nova produção step 3 of this production. */
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
  | 'structure'
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
  structure: 'Montar estrutura',
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

/** One line for lists, the Início queue and the Equipe tab (viewer-independent). */
export function situationOf(input: SituationInput): Situation {
  const { record, view } = input;
  if (view.status === 'archived') return situation('archived', undefined, 'archived', 'Arquivada');
  if (view.status === 'unauthorized') return situation('source', undefined, 'unauthorized', 'Falta autorização');
  const current = currentPiece(record);
  if (current) return pieceSituation(input, current.kind, current.status);
  return isDelivered(record) ? situation('delivery', undefined, 'completed', 'Concluída') : situation('delivery', undefined, 'approved', 'Pronto para baixar');
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
 * carousel and download the package. `mine` marks the viewer's own move (their queue), not a way in.
 */
export function nextStepFor(input: SituationInput): NextStep | null {
  const { record, viewer } = input;
  if (!viewer) return null;
  const situation = situationOf(input);
  const open = step('open', openTarget(situation), false);
  if (situation.stage === 'archived') return open;
  const owner = record.production.ownerId === viewer.personId;
  const admin = hasAnyRole(viewer, ['admin']);
  const editor = hasAnyRole(viewer, ['editor', 'admin']);
  if (situation.status === 'unauthorized') return owner || admin ? step('authorize', { kind: 'source' }, owner) : open;

  const current = currentPiece(record);
  if (!current) {
    if (isDelivered(record)) return open;
    return editor ? step('deliver', { kind: 'delivery' }, owner) : open;
  }
  const { kind, status } = current;
  const piece = pieceOfKind(record, kind);
  const studio: StepTarget = { kind: 'studio', pieceKind: kind };
  switch (status) {
    case 'generating':
    case 'locked':
      return open;
    case 'failed':
      return owner || admin ? step('retry', studio, true) : open;
    case 'not_started':
      if (!editor) return open;
      if (kind === 'article') return step('structure', { kind: 'structure' }, owner);
      return step(kind === 'carousel' ? 'create_carousel' : 'continue', studio, owner);
    case 'draft':
      return editor ? step('continue', studio, owner) : open;
    case 'in_review': {
      const request = piece ? pendingReview(record, piece.id) : undefined;
      if (request?.requestedBy === viewer.personId || (owner && !request)) return null;
      const gate = gateForPiece(kind, input.gates);
      if (gate && hasAnyRole(viewer, gate.roles)) {
        return step('review', { kind: 'review', pieceKind: kind }, request?.assigneeId === undefined || request.assigneeId === viewer.personId);
      }
      return owner ? null : open;
    }
    case 'changes_requested': {
      if (!editor && !owner) return open;
      const requests = piece ? record.reviewRequests.filter((entry) => entry.subject.pieceId === piece.id && entry.withdrawnAt === undefined) : [];
      const sender = requests.sort((a, b) => Date.parse(a.requestedAt) - Date.parse(b.requestedAt)).pop()?.requestedBy;
      return step('adjust', studio, owner || sender === viewer.personId);
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
