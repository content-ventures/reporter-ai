import 'server-only';
import { FULL_SCOPE, type EditorialScope } from './editorial-store.ts';

const text = (value: unknown) => typeof value === 'string' && value ? [value] : [];
const field = (value: unknown, name: string) => (value && typeof value === 'object' ? (value as Record<string, unknown>)[name] : undefined);

/** A feedback target names its production directly or through the entity it is about. */
function feedbackScope(target: unknown): EditorialScope {
  const productions = text(field(target, 'productionId'));
  const entities = ['pieceId', 'versionId', 'runId', 'suggestionId'].flatMap(name => text(field(target, name)));
  return productions.length || entities.length ? { productions, entities } : FULL_SCOPE;
}

/**
 * The rows each named command needs. Single-production commands load that production; the
 * autosave loads only what its lock check reads. Anything unrecognised loads everything,
 * which is always correct, never fast.
 */
export function scopeForRpc(method: string, args: readonly unknown[]): EditorialScope {
  switch (method) {
    case 'session.selectLocalRole': case 'updatePerson': case 'createBlank': return {};
    case 'pipeline.save': return { history: true, recentRuns: 20, workspaceLock: true };
    case 'generation.start': return { productions: text(field(args[1], 'productionId')) };
    case 'generation.cancel': case 'generation.retry': case 'decideSuggestion':
    case 'createVersion': case 'restoreVersion': case 'withdrawReview': return { entities: text(args[0]) };
    case 'saveDraft': return { entities: text(args[0]), parts: ['piece', 'review', 'decision'], sources: 'none', runs: 'none' };
    // Without an explicit assignee, the suggestion reads the sender's earlier requests everywhere.
    case 'requestReview': return field(args[1], 'assigneeId') ? { entities: text(args[0]) } : FULL_SCOPE;
    case 'decide': return { entities: text(field(args[0], 'pieceId')) };
    case 'rename': case 'updateBrief': return { productions: text(args[0]) };
    case 'derive': case 'recordDelivery': return { productions: text(field(args[0], 'productionId')) };
    case 'archive': return { productions: Array.isArray(args[0]) ? args[0].filter((id): id is string => typeof id === 'string') : [] };
    case 'createFromSource': return { sources: text(field(args[0], 'reuseSourceId')) };
    case 'updateSpeakers': case 'setMaterialAuthorization': return { sources: text(args[0]), sourceUsers: text(args[0]) };
    case 'feedback.vote': case 'recordFeedback': return feedbackScope(field(args[0], 'target'));
    default: return FULL_SCOPE;
  }
}
