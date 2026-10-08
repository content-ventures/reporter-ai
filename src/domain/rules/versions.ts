import type { ArticleBody } from '../article.ts';
import type { PieceId, RunId, VersionId } from '../ids.ts';
import { bodyHash } from '../piece.ts';
import type { Piece, PieceBody, Version, VersionOrigin } from '../piece.ts';
import type { SourceVersionRef, VersionRef } from '../refs.ts';
import { ok, refuse } from '../result.ts';
import type { CommandContext, Result } from '../result.ts';

/**
 * Versioning rules. The working draft is one overwritten slot; immutable versions are born at
 * generation end, ⌘S, review request, approval and restore. None of these touch decisions.
 */

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function versionsOfPiece(versions: readonly Version[], pieceId: PieceId): Version[] {
  return versions.filter((version) => version.pieceId === pieceId).sort((a, b) => a.number - b.number);
}

export function nextVersionNumber(versions: readonly Version[], pieceId: PieceId): number {
  return versionsOfPiece(versions, pieceId).reduce((max, version) => Math.max(max, version.number), 0) + 1;
}

export type NewVersion = {
  piece: Piece;
  versions: readonly Version[];
  origin: VersionOrigin;
  /** Defaults to the current draft body. */
  body?: PieceBody;
  runId?: RunId;
  interrupted?: boolean;
  inputs?: VersionRef[];
  sources?: SourceVersionRef[];
  basedOn?: VersionId;
  restoredFrom?: VersionId;
};

export function createVersion(input: NewVersion, ctx: CommandContext): Version {
  const body = clone(input.body ?? input.piece.draft.body);
  const version: Version = {
    id: ctx.newId('ver'),
    pieceId: input.piece.id,
    number: nextVersionNumber(input.versions, input.piece.id),
    body,
    hash: bodyHash(body),
    origin: input.origin,
    inputs: clone(input.inputs ?? input.piece.draft.inputs),
    sources: clone(input.sources ?? input.piece.draft.sources),
    createdBy: ctx.actorId,
    createdAt: ctx.now,
  };
  const basedOn = input.basedOn ?? input.piece.draft.basedOn;
  if (basedOn) version.basedOn = basedOn;
  if (input.runId) version.runId = input.runId;
  if (input.interrupted) version.interrupted = true;
  if (input.restoredFrom) version.restoredFrom = input.restoredFrom;
  return version;
}

/** Points the draft at a version (after saving, generating or restoring). */
export function draftFromVersion(piece: Piece, version: Version, ctx: CommandContext): Piece {
  return {
    ...piece,
    draft: {
      body: clone(version.body),
      revision: piece.draft.revision + 1,
      basedOn: version.id,
      inputs: clone(version.inputs),
      sources: clone(version.sources),
      updatedAt: ctx.now,
      updatedBy: ctx.actorId,
    },
  };
}

export function isDraftDirty(piece: Piece, latest: Version | undefined): boolean {
  if (!latest) return bodyHasContent(piece.draft.body);
  return bodyHash(piece.draft.body) !== latest.hash;
}

function bodyHasContent(body: PieceBody): boolean {
  return body.type === 'article' ? body.blocks.length > 0 || body.title.trim().length > 0 || body.cover !== undefined : body.slides.length > 0;
}

export type DraftRefusal = 'conflict' | 'kind_mismatch';

/**
 * Autosave: overwrites the draft slot. A stale `baseRevision` means another tab/agent saved
 * first; the caller must reload instead of silently overwriting (contract test).
 */
export function updateDraft(piece: Piece, body: PieceBody, baseRevision: number, ctx: CommandContext): Result<Piece, DraftRefusal> {
  if (baseRevision !== piece.draft.revision) {
    return refuse('conflict', 'O texto foi alterado em outra aba. Recarregue para continuar.', {
      expected: piece.draft.revision,
      received: baseRevision,
    });
  }
  if (body.type !== piece.draft.body.type) return refuse('kind_mismatch', 'Conteúdo incompatível com a peça.');
  return ok({
    ...piece,
    draft: { ...piece.draft, body: clone(body), revision: piece.draft.revision + 1, updatedAt: ctx.now, updatedBy: ctx.actorId },
  });
}

export type SaveVersionRefusal = 'unchanged' | 'empty';

/** ⌘S: freezes the draft as a new `edit` version, unless nothing changed since the latest. */
export function saveVersion(
  piece: Piece,
  versions: readonly Version[],
  ctx: CommandContext,
  origin: VersionOrigin = 'edit',
): Result<{ version: Version; piece: Piece }, SaveVersionRefusal> {
  const latest = versionsOfPiece(versions, piece.id).pop();
  if (!bodyHasContent(piece.draft.body)) return refuse('empty', 'Não há conteúdo para salvar.');
  if (latest && bodyHash(piece.draft.body) === latest.hash) {
    return refuse('unchanged', 'Nenhuma alteração desde a última versão.', { versionId: latest.id, number: latest.number });
  }
  const version = createVersion({ piece, versions, origin, basedOn: latest?.id }, ctx);
  return ok({ version, piece: draftFromVersion(piece, version, ctx) });
}

/** "Enviar para aprovação": reuses the latest version when the draft equals it. */
export function ensureVersion(
  piece: Piece,
  versions: readonly Version[],
  ctx: CommandContext,
): Result<{ version: Version; piece: Piece; created: boolean }, 'empty'> {
  const saved = saveVersion(piece, versions, ctx);
  if (saved.ok) return ok({ ...saved.value, created: true });
  if (saved.refusal.code === 'empty') return refuse('empty', saved.refusal.message);
  const latest = versionsOfPiece(versions, piece.id).pop() as Version;
  return ok({ version: latest, piece, created: false });
}

export type RestoreRefusal = 'unknown_version' | 'nothing_to_restore';

/**
 * Restore = a NEW version (origin `restore`) with the old body. It never alters decisions:
 * the restored copy has its own id, so it needs its own approval, and existing approvals stay.
 */
export function restoreVersion(
  piece: Piece,
  versions: readonly Version[],
  targetVersionId: VersionId,
  ctx: CommandContext,
): Result<{ version: Version; piece: Piece }, RestoreRefusal> {
  const pieceVersions = versionsOfPiece(versions, piece.id);
  const target = pieceVersions.find((version) => version.id === targetVersionId);
  if (!target) return refuse('unknown_version', 'Versão não encontrada.');
  const latest = pieceVersions[pieceVersions.length - 1];
  if (latest.hash === target.hash && bodyHash(piece.draft.body) === target.hash) {
    return refuse('nothing_to_restore', 'O texto atual já é igual a esta versão.');
  }
  const version = createVersion(
    {
      piece,
      versions,
      origin: 'restore',
      body: target.body,
      inputs: target.inputs,
      sources: target.sources,
      basedOn: latest.id,
      restoredFrom: target.id,
    },
    ctx,
  );
  return ok({ version, piece: draftFromVersion(piece, version, ctx) });
}

export type SettledGeneration = { versions: Version[]; piece: Piece };

/**
 * Closes a generation run. v1 · IA is the PURE run output; if the person edited finished
 * sections while later ones streamed, those edits become a following `edit` version, so
 * provenance and the AI-retention metric stay honest.
 *
 * Callers must freeze a dirty draft (`saveVersion`) BEFORE starting a regeneration, so
 * unsaved edits on older content are never mistaken for edits made during this run.
 */
export function settleGeneration(
  input: {
    piece: Piece;
    versions: readonly Version[];
    output: ArticleBody | PieceBody;
    runId: RunId;
    /** When the run started; only draft updates at/after it count as edits during streaming. */
    runStartedAt: string;
    interrupted: boolean;
    inputs?: VersionRef[];
    sources?: SourceVersionRef[];
  },
  ctx: CommandContext,
): SettledGeneration {
  const generated = createVersion(
    {
      piece: input.piece,
      versions: input.versions,
      origin: 'generation',
      body: input.output,
      runId: input.runId,
      interrupted: input.interrupted,
      inputs: input.inputs,
      sources: input.sources,
    },
    ctx,
  );
  const draftEdited =
    Date.parse(input.piece.draft.updatedAt) >= Date.parse(input.runStartedAt) &&
    bodyHasContent(input.piece.draft.body) &&
    input.piece.draft.body.type === generated.body.type &&
    bodyHash(input.piece.draft.body) !== generated.hash &&
    // A draft untouched since an older version is not an edit made during streaming.
    !input.versions.some((version) => version.pieceId === input.piece.id && version.hash === bodyHash(input.piece.draft.body));
  if (!draftEdited) {
    return { versions: [generated], piece: draftFromVersion(input.piece, generated, ctx) };
  }
  const edited = createVersion(
    {
      piece: input.piece,
      versions: [...input.versions, generated],
      origin: 'edit',
      body: input.piece.draft.body,
      inputs: generated.inputs,
      sources: generated.sources,
      basedOn: generated.id,
    },
    ctx,
  );
  return { versions: [generated, edited], piece: draftFromVersion(input.piece, edited, ctx) };
}
