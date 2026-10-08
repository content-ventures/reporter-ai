import { approvalStateOf } from '../../../domain/approval.ts';
import { bodyHash, PIECE_LABELS, toVersionRef } from '../../../domain/piece.ts';
import type { Piece, PieceKind, Version } from '../../../domain/piece.ts';
import { activeRun, findVersion, isApproved, latestApproved, latestVersion, pendingReview, pieceOfKind } from '../../../domain/record.ts';
import type { ProductionRecord } from '../../../domain/record.ts';
import { sameRefSet } from '../../../domain/refs.ts';
import type { VersionRef } from '../../../domain/refs.ts';
import { canDecide } from '../../../domain/rules/decide.ts';
import type { DecideState } from '../../../domain/rules/decide.ts';
import { canDerive } from '../../../domain/rules/derive.ts';
import { resolveExport } from '../../../domain/rules/export.ts';
import { canGenerate } from '../../../domain/rules/generate.ts';
import { PIECE_PARENTS } from '../../../domain/rules/status.ts';
import { saveVersion } from '../../../domain/rules/versions.ts';
import { gateForPiece } from '../../../domain/decision.ts';
import type { DecisionKind } from '../../../domain/decision.ts';
import { evaluatePieceChecks } from '../../../domain/views.ts';
import { ALLOWED, blocked, guardFrom } from '../../../ports/common.ts';
import type { Guard } from '../../../ports/common.ts';
import type { PieceGuards, ProductionGuards } from '../../../ports/production-queries.ts';
import { alreadyRequestedMessage, gateMembers } from './send-check.ts';
import { currentMember } from './people.ts';
import { probeContext } from './read-context.ts';
import type { ReadContext } from './read-context.ts';

/**
 * Button hints computed with the SAME pure rules the commands enforce, for the acting member.
 * Each disabled action carries the pt-BR reason shown in its Tooltip.
 */

const RUNNING = blocked('run_in_progress', 'Aguarde a IA terminar.');

function decideState(ctx: ReadContext, record: ProductionRecord): DecideState {
  const member = currentMember(ctx.state);
  return member ? { ...record, member } : { ...record };
}

/** The version a decision would be about: the one under review, else the latest. */
export function reviewSubject(record: ProductionRecord, piece: Piece): Version | undefined {
  const request = pendingReview(record, piece.id);
  const requested = request ? findVersion(record, request.subject.versionId) : undefined;
  return requested ?? latestVersion(record, piece.id);
}

export function decisionGuard(ctx: ReadContext, record: ProductionRecord, piece: Piece, version: Version | undefined, decision: DecisionKind): Guard {
  const gate = gateForPiece(piece.kind, ctx.gates);
  if (!gate) return blocked('no_gate', 'Esta peça não passa por aprovação.');
  if (!version) return blocked('no_version', 'Envie uma versão para aprovação primeiro.');
  const checks = decision === 'approved' ? evaluatePieceChecks(record, piece, version.body, ctx.templates, ctx.assets) : undefined;
  return guardFrom(
    canDecide(decideState(ctx, record), {
      gate,
      subject: toVersionRef(version),
      decision,
      displayedHash: version.hash,
      ...(checks ? { checks } : {}),
    }),
  );
}

/**
 * "Enviar para aprovação" is blocked only when sending is impossible: the AI is writing, the text
 * already waits for a decision, there is no text, nobody else can approve, or it is approved as is.
 * "Falta" items do not block the button: the pre-send dialog lists them (and the command refuses).
 */
function requestReviewGuard(ctx: ReadContext, record: ProductionRecord, piece: Piece): Guard {
  const gate = gateForPiece(piece.kind, ctx.gates);
  if (!gate) return blocked('no_gate', 'Esta peça não passa por aprovação.');
  if (activeRun(record, piece.id)) return RUNNING;
  const request = pendingReview(record, piece.id);
  if (request) return blocked('already_requested', alreadyRequestedMessage(ctx.state, request));
  const saved = saveVersion(piece, record.versions, probeContext(ctx));
  if (!saved.ok && saved.refusal.code === 'empty') return blocked('empty', 'O texto está vazio.');
  if (gateMembers(ctx.state, gate, ctx.state.sessionPersonId).length === 0) {
    return blocked('no_approver', 'Ninguém pode aprovar ainda. Peça a um admin o papel de aprovador.');
  }
  const latest = latestVersion(record, piece.id);
  const unchanged = latest !== undefined && bodyHash(piece.draft.body) === latest.hash;
  if (approvalStateOf(record, piece.id) === 'approved' || (unchanged && isApproved(record, toVersionRef(latest)))) {
    return blocked('already_approved', 'Este texto já está aprovado.');
  }
  return ALLOWED;
}

export function pieceGuards(ctx: ReadContext, record: ProductionRecord, kind: PieceKind): PieceGuards {
  const generate = guardFrom(canGenerate(record, kind));
  const piece = pieceOfKind(record, kind);
  if (!piece) {
    const missing = blocked('not_started', `${PIECE_LABELS[kind]} ainda não foi iniciado.`);
    return { generate, saveVersion: missing, requestReview: missing, approve: missing, requestChanges: missing };
  }
  const running = activeRun(record, piece.id) !== undefined;
  const save = saveVersion(piece, record.versions, probeContext(ctx));
  const subject = reviewSubject(record, piece);
  return {
    generate,
    saveVersion: running ? RUNNING : guardFrom(save),
    requestReview: requestReviewGuard(ctx, record, piece),
    approve: decisionGuard(ctx, record, piece, subject, 'approved'),
    requestChanges: decisionGuard(ctx, record, piece, subject, 'changes_requested'),
  };
}

export function deriveGuard(record: ProductionRecord, kind: PieceKind): Guard & { from?: VersionRef } {
  const parents = (PIECE_PARENTS[kind] ?? []).filter((parent) => record.production.plan.includes(parent));
  const parentKind = parents[0];
  if (!parentKind) return blocked('not_derivable', `${PIECE_LABELS[kind]} não deriva de outra peça.`);
  const parentPiece = pieceOfKind(record, parentKind);
  const approved = parentPiece ? latestApproved(record, parentPiece.id) : undefined;
  if (!approved) return blocked('parent_not_ready', `Disponível após aprovar o ${PIECE_LABELS[parentKind].toLowerCase()}.`);
  const derivable = canDerive(record, approved.ref);
  if (!derivable.ok) return guardFrom(derivable);
  const existing = pieceOfKind(record, kind);
  if (existing && sameRefSet(existing.draft.inputs, [approved.ref])) {
    return { ...blocked('already_derived', `O ${PIECE_LABELS[kind].toLowerCase()} já usa o ${PIECE_LABELS[parentKind].toLowerCase()} aprovado.`), from: approved.ref };
  }
  return { allowed: true, from: approved.ref };
}

export function productionGuards(ctx: ReadContext, record: ProductionRecord): ProductionGuards {
  const pieces: ProductionGuards['pieces'] = {};
  const derive: ProductionGuards['derive'] = {};
  for (const kind of record.production.plan) {
    pieces[kind] = pieceGuards(ctx, record, kind);
    if (PIECE_PARENTS[kind]?.some((parent) => record.production.plan.includes(parent))) derive[kind] = deriveGuard(record, kind);
  }
  const archived = record.production.archivedAt !== undefined;
  const running = activeRun(record) !== undefined;
  return {
    pieces,
    derive,
    export: archived ? blocked('archived', 'Produção arquivada.') : guardFrom(resolveExport(record).result),
    archive: archived ? blocked('archived', 'Produção já arquivada.') : running ? RUNNING : ALLOWED,
  };
}
