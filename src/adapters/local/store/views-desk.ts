import { dueStateOf } from '../../../domain/approval.ts';
import { PIECE_LABELS } from '../../../domain/piece.ts';
import type { Piece } from '../../../domain/piece.ts';
import { lastRun, pendingReview, pieceDecisions } from '../../../domain/record.ts';
import type { ProductionRecord } from '../../../domain/record.ts';
import { pieceStatus } from '../../../domain/rules/status.ts';
import { NEXT_STEP_LABELS, writingParts } from '../../../domain/situation.ts';
import type { NextStep, NextStepKind, SituationStage, StepTarget } from '../../../domain/situation.ts';
import type { ProductionView } from '../../../domain/views.ts';
import { hasAnyRole } from '../../../domain/workspace.ts';
import type { Member } from '../../../domain/workspace.ts';
import type { DeskGroup, DeskGroupId, DeskItem, DeskView, InProgressItem, TeamStage } from '../../../ports/production-queries.ts';
import { currentMember, personOf } from './people.ts';
import { recordOf, viewOf } from './read-context.ts';
import type { ReadContext } from './read-context.ts';
import { nextStepOf } from './views-list.ts';
import { isInQueue, toApproveItems } from './views-queue.ts';

/**
 * Início "Minha mesa" (D1): what needs the acting member, grouped by urgency and role, what is in
 * progress, the team by stage and the week line.
 *
 * - Para aprovar: their "Aprovações" queue (same list, same order).
 * - Devolvidos para ajuste: returned pieces they own or sent.
 * - Com erro: failed generations they own (admins: everyone's).
 * - Material sem autorização: their own productions.
 * - Aguardando outra pessoa: what they own or sent that waits for someone else (no button).
 */

/** "Equipe" stages in reading order (all of them, even when empty). */
export const TEAM_STAGES: readonly TeamStage[] = ['material', 'writing', 'approval', 'carousel', 'delivery'];

const GROUP_ORDER: readonly DeskGroupId[] = ['to_approve', 'returned', 'failed', 'unauthorized', 'waiting_other'];

/** Most rows "Em andamento" shows (the rest is behind "Ver todas"). */
export const IN_PROGRESS_LIMIT = 6;

const TEAM_STAGE_OF: Record<SituationStage, TeamStage | undefined> = {
  source: 'material',
  article: 'writing',
  approval: 'approval',
  carousel: 'carousel',
  delivery: 'delivery',
  archived: undefined,
};

function step(kind: NextStepKind, target: StepTarget): NextStep {
  return { kind, label: NEXT_STEP_LABELS[kind], target, mine: true };
}

type Entry = { record: ProductionRecord; view: ProductionView };

function pieceBase(record: ProductionRecord, piece: Piece): Pick<DeskItem, 'productionId' | 'productionTitle' | 'pieceId' | 'kind' | 'pieceLabel'> {
  return { productionId: record.production.id, productionTitle: record.production.title, pieceId: piece.id, kind: piece.kind, pieceLabel: PIECE_LABELS[piece.kind] };
}

const newestFirst = (a: DeskItem, b: DeskItem) => Date.parse(b.at ?? '') - Date.parse(a.at ?? '') || a.productionId.localeCompare(b.productionId);

/** The groups of one production for the viewer (to_approve comes from the queue). */
function groupsOf(ctx: ReadContext, viewer: Member, { record, view }: Entry, add: (group: DeskGroupId, item: DeskItem) => void): void {
  const owner = record.production.ownerId === viewer.personId;
  const admin = hasAnyRole(viewer, ['admin']);
  if (view.status === 'unauthorized') {
    if (owner) {
      add('unauthorized', {
        productionId: record.production.id,
        productionTitle: record.production.title,
        status: 'unauthorized',
        from: personOf(ctx.state, record.production.ownerId),
        at: record.production.createdAt,
        due: 'none',
        nextStep: step('authorize', { kind: 'source' }),
      });
    }
    return;
  }
  for (const kind of record.production.plan) {
    const piece = record.pieces.find((entry) => entry.kind === kind);
    if (!piece) continue;
    const status = pieceStatus(record, kind);
    if (status === 'changes_requested') {
      const decision = pieceDecisions(record, piece.id).pop();
      const sender = record.reviewRequests
        .filter((request) => request.subject.pieceId === piece.id && request.withdrawnAt === undefined)
        .sort((a, b) => Date.parse(a.requestedAt) - Date.parse(b.requestedAt))
        .pop()?.requestedBy;
      if (!decision || (!owner && sender !== viewer.personId)) continue;
      const item: DeskItem = {
        ...pieceBase(record, piece),
        status,
        from: personOf(ctx.state, decision.by),
        at: decision.at,
        due: 'none',
        nextStep: step('adjust', { kind: 'studio', pieceKind: kind }),
      };
      if (decision.note) item.note = decision.note;
      add('returned', item);
    } else if (status === 'failed') {
      if (!owner && !admin) continue;
      const run = lastRun(record, piece.id);
      const item: DeskItem = {
        ...pieceBase(record, piece),
        status,
        from: personOf(ctx.state, run?.createdBy),
        at: run?.endedAt ?? run?.createdAt ?? record.production.updatedAt,
        due: 'none',
        nextStep: step('retry', { kind: 'studio', pieceKind: kind }),
      };
      const progress = run ? writingParts(run) : undefined;
      if (progress) item.progress = progress;
      add('failed', item);
    } else if (status === 'in_review') {
      const request = pendingReview(record, piece.id);
      if (!request || isInQueue(ctx, viewer, piece, request)) continue;
      if (!owner && request.requestedBy !== viewer.personId) continue;
      const item: DeskItem = {
        ...pieceBase(record, piece),
        status,
        from: personOf(ctx.state, request.requestedBy),
        at: request.requestedAt,
        due: dueStateOf(request.dueOn, ctx.now),
        withPerson: request.assigneeId ? personOf(ctx.state, request.assigneeId) : null,
        nextStep: null,
      };
      if (request.note) item.note = request.note;
      if (request.dueOn) item.dueOn = request.dueOn;
      add('waiting_other', item);
    }
  }
}

function inProgressItem(ctx: ReadContext, { record, view }: Entry): InProgressItem {
  const item: InProgressItem = {
    productionId: view.id,
    productionTitle: view.title,
    situation: view.situation,
    owner: personOf(ctx.state, view.ownerId) ?? { id: view.ownerId, name: 'Sistema', initials: 'S' },
    updatedAt: view.updatedAt,
    nextStep: nextStepOf(ctx, record, view),
  };
  // "1,6 de 2 laudas" while the article is what the production is on.
  const article = view.pieces.find((piece) => piece.kind === 'article');
  if (article && article.draft.characters > 0 && (view.situation.stage === 'article' || view.situation.stage === 'approval')) {
    item.characters = article.draft.characters;
    item.size = view.brief.size;
  }
  return item;
}

const byActivity = (a: Entry, b: Entry) => Date.parse(b.view.updatedAt) - Date.parse(a.view.updatedAt) || a.view.id.localeCompare(b.view.id);

export function deskView(ctx: ReadContext, week: DeskView['week']): DeskView {
  const empty: DeskView = { groups: [], needsYou: 0, inProgress: [], inProgressTotal: 0, team: TEAM_STAGES.map((stage) => ({ stage, items: [] })), week };
  const viewer = currentMember(ctx.state);
  const entries: Entry[] = ctx.state.productions
    .filter((production) => !production.production.archivedAt)
    .map((production) => {
      const record = recordOf(ctx, production);
      return { record, view: viewOf(ctx, production, record) };
    });
  const team = TEAM_STAGES.map((stage) => ({
    stage,
    items: entries
      .filter((entry) => TEAM_STAGE_OF[entry.view.situation.stage] === stage)
      .sort(byActivity)
      .map((entry) => inProgressItem(ctx, entry)),
  }));
  if (!viewer) return { ...empty, team };

  const byGroup = new Map<DeskGroupId, DeskItem[]>(GROUP_ORDER.map((id) => [id, []]));
  const add = (group: DeskGroupId, item: DeskItem) => byGroup.get(group)?.push(item);
  for (const item of toApproveItems(ctx)) {
    const desk: DeskItem = {
      productionId: item.productionId,
      productionTitle: item.productionTitle,
      pieceId: item.pieceId,
      kind: item.kind,
      pieceLabel: item.pieceLabel,
      status: 'in_review',
      from: item.requester,
      at: item.requestedAt,
      due: item.due,
      nextStep: step('review', { kind: 'review', pieceKind: item.kind }),
    };
    if (item.note) desk.note = item.note;
    if (item.dueOn) desk.dueOn = item.dueOn;
    add('to_approve', desk);
  }
  for (const entry of entries) groupsOf(ctx, viewer, entry, add);
  const groups: DeskGroup[] = GROUP_ORDER.map((id) => ({ id, items: byGroup.get(id) ?? [] }))
    .filter((group) => group.items.length > 0)
    .map((group) => (group.id === 'to_approve' ? group : { ...group, items: [...group.items].sort(newestFirst) }));

  // "Em andamento": what is not already a row above, the viewer's own (everyone's when they own none).
  const grouped = new Set(groups.flatMap((group) => group.items.map((item) => item.productionId)));
  const active = entries.filter((entry) => entry.view.status !== 'completed' && !grouped.has(entry.view.id));
  const ownsActive = entries.some((entry) => entry.view.ownerId === viewer.personId && entry.view.status !== 'completed');
  const pool = (ownsActive ? active.filter((entry) => entry.view.ownerId === viewer.personId) : active).sort(byActivity);
  const inProgress = pool.slice(0, IN_PROGRESS_LIMIT).map((entry) => inProgressItem(ctx, entry));
  const desk: DeskView = {
    groups,
    needsYou: groups.filter((group) => group.id !== 'waiting_other').reduce((total, group) => total + group.items.length, 0),
    inProgress,
    inProgressTotal: pool.length,
    team,
    week,
  };
  // The wide "Continuar" card of an empty queue: the viewer's own next move only (never someone else's text).
  const next = pool.map((entry) => inProgress.find((item) => item.productionId === entry.view.id) ?? inProgressItem(ctx, entry)).find((item) => item.nextStep?.mine);
  if (next) desk.continueWith = next;
  return desk;
}
