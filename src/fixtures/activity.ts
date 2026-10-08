import { DECISION_LABELS, requestRound, toSourceVersionRef, toVersionRef, versionLabel, versionsOf } from '../domain/index.ts';
import type { ActivityEvent, ActivityType, ActorId, FeedbackEntry, IsoDateTime, ProductionRecord, Ref } from '../domain/index.ts';
import { personName, WORKSPACE_ID } from './people.ts';

/**
 * Semantic activity feed derived from the fixture records (Timeline, notification dot). Only
 * meaningful events: never autosaves, keystrokes or assistant runs. Ascending by time; ids
 * follow that order so the feed is deterministic.
 */

type Draft = Omit<ActivityEvent, 'id' | 'workspaceId'>;

function event(
  type: ActivityType,
  at: IsoDateTime,
  actorId: ActorId,
  productionId: string,
  subject?: Ref,
  data?: ActivityEvent['data'],
): Draft {
  const entry: Draft = { type, at, actorId, productionId };
  if (subject) entry.subject = subject;
  if (data) entry.data = data;
  return entry;
}

function recordActivity(record: ProductionRecord): Draft[] {
  const { production } = record;
  const out: Draft[] = [event('production.created', production.createdAt, production.createdBy, production.id, undefined, { title: production.title })];
  for (const source of record.sources) {
    out.push(event('source.added', source.createdAt, source.createdBy, production.id, toSourceVersionRef(source), { title: source.title }));
    const { rights } = source;
    if (rights.authorized && rights.authorizedAt && rights.authorizedBy && rights.authorizedAt !== source.createdAt) {
      out.push(event('source.authorized', rights.authorizedAt, rights.authorizedBy, production.id, toSourceVersionRef(source)));
    }
  }
  for (const run of record.runs) {
    if (run.kind !== 'article.generate' && run.kind !== 'carousel.generate') continue;
    // The same data as live events: the piece kind and the run kind ("Geração do artigo", "o artigo v2").
    const piece = run.kind === 'article.generate' ? 'article' : 'carousel';
    if (run.startedAt) out.push(event('run.started', run.startedAt, run.createdBy, production.id, undefined, { piece, runKind: run.kind }));
    if (!run.endedAt) continue;
    const ended: ActivityType | undefined =
      run.status === 'completed' ? 'run.completed' : run.status === 'failed' ? 'run.failed' : run.status === 'cancelled' ? 'run.cancelled' : undefined;
    if (ended) {
      const data: ActivityEvent['data'] = { piece, runKind: run.kind };
      if (run.error) data.error = run.error.message;
      out.push(event(ended, run.endedAt, run.createdBy, production.id, run.output, data));
    }
  }
  for (const piece of record.pieces) {
    const versions = versionsOf(record, piece.id);
    for (const version of versions) {
      if (version.origin === 'generation') continue;
      const type: ActivityType = version.origin === 'restore' ? 'version.restored' : 'version.created';
      out.push(
        event(type, version.createdAt, version.createdBy, production.id, toVersionRef(version), {
          piece: piece.kind,
          number: version.number,
          label: versionLabel(version, versions),
        }),
      );
    }
  }
  for (const request of record.reviewRequests) {
    // The same data as live sends: piece, number, round, "Quem aprova" and "Para quando".
    const piece = record.pieces.find((entry) => entry.id === request.subject.pieceId);
    const data: ActivityEvent['data'] = { number: request.subject.number, round: requestRound(record, request) };
    if (piece) data.piece = piece.kind;
    if (request.assigneeId) {
      data.assigneeId = request.assigneeId;
      data.assigneeName = personName(request.assigneeId);
    }
    if (request.dueOn) data.dueOn = request.dueOn;
    out.push(event('review.requested', request.requestedAt, request.requestedBy, production.id, request.subject, data));
    if (request.withdrawnAt) {
      const withdrawn: ActivityEvent['data'] = { number: request.subject.number };
      if (piece) withdrawn.piece = piece.kind;
      out.push(event('review.withdrawn', request.withdrawnAt, request.withdrawnBy ?? request.requestedBy, production.id, request.subject, withdrawn));
    }
  }
  for (const decision of record.decisions) {
    const data: ActivityEvent['data'] = { decision: decision.decision, label: DECISION_LABELS[decision.decision] };
    if (decision.subject.kind === 'version') data.number = decision.subject.number;
    if (decision.note) data.hasNote = true;
    out.push(event('decision.recorded', decision.at, decision.by, production.id, decision.subject, data));
  }
  for (const delivery of record.deliveries) {
    const type: ActivityType = delivery.status === 'completed' ? 'delivery.completed' : 'delivery.failed';
    out.push(event(type, delivery.createdAt, delivery.createdBy, production.id, undefined, { files: delivery.items.length, channel: delivery.channel }));
  }
  return out;
}

function feedbackActivity(entry: FeedbackEntry): Draft {
  const productionId = entry.target.kind === 'production' ? entry.target.productionId : undefined;
  const draft: Draft = { type: 'feedback.recorded', at: entry.at, actorId: entry.by, data: entry.rating ? { rating: entry.rating } : {} };
  if (productionId) draft.productionId = productionId;
  return draft;
}

export function deriveActivity(records: readonly ProductionRecord[], feedback: readonly FeedbackEntry[] = []): ActivityEvent[] {
  const drafts = [...records.flatMap(recordActivity), ...feedback.map(feedbackActivity)];
  return drafts
    .map((draft, index) => ({ draft, index }))
    .sort((a, b) => Date.parse(a.draft.at) - Date.parse(b.draft.at) || a.index - b.index)
    .map(({ draft }, position) => ({ id: `act-${String(position + 1).padStart(4, '0')}`, workspaceId: WORKSPACE_ID, ...draft }));
}
