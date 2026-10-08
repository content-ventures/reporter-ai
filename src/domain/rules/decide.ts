import type { ImageRightsRecord } from '../asset.ts';
import { readiness } from '../checks.ts';
import type { CheckResult } from '../checks.ts';
import type { Decision, DecisionAnchor, DecisionKind, GateDefinition } from '../decision.ts';
import { activeRun, findVersion, latestDecisionOn, pendingReview, pendingSuggestions } from '../record.ts';
import type { ProductionRecord } from '../record.ts';
import type { VersionRef } from '../refs.ts';
import { ok, refuse } from '../result.ts';
import type { CommandContext, Result } from '../result.ts';
import { hasAnyRole } from '../workspace.ts';
import type { Member, Role } from '../workspace.ts';

/**
 * Gate rules (REQ-T.6). Enforced by the adapter (and, later, by the server); the UI calls the
 * same functions to disable buttons with the reason in a Tooltip.
 */

export type DecideRefusal =
  | 'forbidden_role'
  | 'unknown_version'
  | 'hash_mismatch'
  | 'run_in_progress'
  | 'suggestion_pending'
  | 'decision_not_allowed'
  | 'blocking_checks'
  | 'already_decided'
  | 'note_required'
  /** The person who sent the request never decides on it (two-person gate, admins included). */
  | 'self_decision';

/**
 * Two-person gate (R3): whoever sent a piece for approval does not approve or return it. A named
 * policy so it can be relaxed later (e.g. one-person newsrooms) without hunting for the rule.
 */
export const REQUESTER_MAY_DECIDE = false;

export type DecideState = Pick<ProductionRecord, 'versions' | 'decisions' | 'runs' | 'suggestions'> & {
  /** The acting member; undefined means not a member of the workspace. */
  member?: Member;
  /** Sends of the record: whoever sent the pending one does not decide on it (`self_decision`). */
  reviewRequests?: ProductionRecord['reviewRequests'];
};

export type DecisionRequest = {
  gate: GateDefinition;
  subject: VersionRef;
  /** Omit to ask "can this person decide at all?" (button state before choosing). */
  decision?: DecisionKind;
  /** Hash of the version rendered on screen; must equal the subject's. */
  displayedHash?: string;
  checks?: readonly CheckResult[];
};

const ROLE_NAMES: Record<Role, string> = { editor: 'editor', approver: 'aprovador', creative_reviewer: 'revisor criativo', admin: 'admin' };

/** "Só aprovador ou admin decide nesta etapa." — the reason a member without the role reads (B06). */
export function forbiddenRoleMessage(roles: readonly Role[]): string {
  const names = roles.map((role) => ROLE_NAMES[role]);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} ou ${names[names.length - 1]}` : (names[0] ?? 'quem tem o papel');
  return `Só ${list} decide nesta etapa.`;
}

export function canDecide(state: DecideState, request: DecisionRequest): Result<true, DecideRefusal> {
  if (!hasAnyRole(state.member, request.gate.roles)) {
    return refuse('forbidden_role', forbiddenRoleMessage(request.gate.roles));
  }
  const pending = state.reviewRequests ? pendingReview({ reviewRequests: state.reviewRequests, decisions: state.decisions }, request.subject.pieceId) : undefined;
  if (!REQUESTER_MAY_DECIDE && pending && state.member && pending.requestedBy === state.member.personId) {
    return refuse('self_decision', 'Quem enviou não aprova o próprio envio.');
  }
  const version = findVersion(state, request.subject.versionId);
  if (!version || version.pieceId !== request.subject.pieceId) {
    return refuse('unknown_version', 'Versão não encontrada.');
  }
  const hashes = [request.subject.hash, request.displayedHash].filter((hash): hash is string => hash !== undefined);
  if (hashes.some((hash) => hash !== version.hash)) {
    return refuse('hash_mismatch', 'O texto mudou depois do envio. Recarregue para ver a versão enviada.', {
      expected: version.hash,
    });
  }
  if (activeRun(state, version.pieceId)) {
    return refuse('run_in_progress', 'Aguarde a IA terminar.');
  }
  if (pendingSuggestions(state, version.pieceId).length > 0) {
    return refuse('suggestion_pending', 'Aceite ou descarte as sugestões pendentes.');
  }
  if (request.decision === undefined) return ok(true);

  if (!request.gate.decisions.includes(request.decision)) {
    return refuse('decision_not_allowed', 'Decisão não disponível nesta etapa.');
  }
  if (request.decision === 'approved' && request.checks) {
    const { blockers } = readiness(request.checks);
    if (blockers.length > 0) {
      return refuse('blocking_checks', blockers[0].detail ?? `${blockers[0].label} pendente.`, {
        checks: blockers.map((check) => check.id),
      });
    }
  }
  const latest = latestDecisionOn(state, request.subject);
  if (latest?.decision === request.decision) {
    return refuse('already_decided', 'Este texto já tem esta decisão.', { decisionId: latest.id });
  }
  return ok(true);
}

export type DecideInput = DecisionRequest & {
  decision: DecisionKind;
  note?: string;
  anchors?: DecisionAnchor[];
  /** Credit and rights of the version's images, kept with the decision (see `articleImageRights`). */
  images?: readonly ImageRightsRecord[];
};

/** Records a gate decision. "Devolver" (changes_requested) and "Recusar" require a note. */
export function decide(state: DecideState, input: DecideInput, ctx: CommandContext): Result<Decision, DecideRefusal> {
  const allowed = canDecide(state, input);
  if (!allowed.ok) return allowed;
  const note = input.note?.trim();
  if (input.gate.requiresNote.includes(input.decision) && !note) {
    return refuse('note_required', 'Escreva o que ajustar.');
  }
  const decision: Decision = {
    id: ctx.newId('dec'),
    gate: input.gate.id,
    subject: input.subject,
    decision: input.decision,
    by: ctx.actorId,
    at: ctx.now,
    checks: input.checks ? input.checks.map((check) => ({ ...check })) : [],
  };
  if (note) decision.note = note;
  if (input.anchors && input.anchors.length > 0) decision.anchors = input.anchors.map((anchor) => ({ ...anchor }));
  if (input.images && input.images.length > 0) decision.images = input.images.map((image) => ({ ...image, rights: { ...image.rights } }));
  return ok(decision);
}
