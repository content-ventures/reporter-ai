import type { ActivityId, ActorId, IsoDateTime, ProductionId, WorkspaceId } from './ids.ts';
import type { Ref } from './refs.ts';

/**
 * Semantic activity feed (Timeline, notifications, REQ-T.8, R7 audit). Only meaningful events
 * are logged: never keystrokes or autosaves. Maps naturally to an audit table later.
 */
export type ActivityType =
  | 'production.created'
  | 'production.archived'
  | 'source.added'
  | 'source.revised'
  | 'source.authorized'
  | 'run.started'
  | 'run.completed'
  | 'run.failed'
  | 'run.cancelled'
  | 'version.created'
  | 'version.restored'
  | 'review.requested'
  | 'review.withdrawn'
  | 'decision.recorded'
  | 'suggestion.applied'
  | 'suggestion.discarded'
  | 'text.reviewed'
  | 'text.review_reopened'
  | 'delivery.completed'
  | 'delivery.failed'
  | 'feedback.recorded';

export type ActivityEvent = {
  id: ActivityId;
  workspaceId: WorkspaceId;
  productionId?: ProductionId;
  type: ActivityType;
  actorId: ActorId;
  at: IsoDateTime;
  subject?: Ref;
  /** Small serialisable facts for the timeline line ("v4", "Mais direto", file count…). */
  data?: Record<string, string | number | boolean>;
};

/** Events that light the notification dot (never a number). */
export const NOTIFYING_ACTIVITY: readonly ActivityType[] = [
  'run.completed',
  'run.failed',
  'review.requested',
  'decision.recorded',
  'delivery.completed',
  'delivery.failed',
];

export function isNotifying(event: Pick<ActivityEvent, 'type'>): boolean {
  return NOTIFYING_ACTIVITY.includes(event.type);
}
