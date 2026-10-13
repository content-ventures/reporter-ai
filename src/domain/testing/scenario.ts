/**
 * Test-only helpers for domain tests (not exported from the domain barrel). Deterministic
 * clock and ids; small pt-BR fictional material.
 */
import { headingBlock, paragraphBlock, quoteBlock } from '../article.ts';
import type { ArticleBody } from '../article.ts';
import type { ImageRightsRecord } from '../asset.ts';
import type { CarouselBody, CarouselTemplate } from '../carousel.ts';
import { ARTICLE_GATE, CAROUSEL_GATE } from '../decision.ts';
import type { Decision, GateDefinition } from '../decision.ts';
import type { Piece, PieceBody, PieceKind, Version } from '../piece.ts';
import { toVersionRef } from '../piece.ts';
import type { Production } from '../production.ts';
import type { ProductionRecord } from '../record.ts';
import { segmentRef } from '../refs.ts';
import type { VersionRef } from '../refs.ts';
import type { CommandContext } from '../result.ts';
import { createVersion, draftFromVersion, updateDraft } from '../rules/versions.ts';
import { createTranscriptSource, toSourceVersionRef } from '../source.ts';
import type { Source } from '../source.ts';
import { parseTranscript } from '../text/transcript-parse.ts';
import type { Member } from '../workspace.ts';

export const WORKSPACE = 'ws-francal';
export const JOAO = 'person-joao';
export const PEDRO = 'person-pedro';

export const MEMBERS: Record<string, Member> = {
  [JOAO]: { workspaceId: WORKSPACE, personId: JOAO, roles: ['editor', 'admin'] },
  [PEDRO]: { workspaceId: WORKSPACE, personId: PEDRO, roles: ['approver'] },
  editorOnly: { workspaceId: WORKSPACE, personId: 'person-ana', roles: ['editor'] },
};

export const SAMPLE_TRANSCRIPT = [
  'Entrevistadora: Como começou o Ateliê Sul?',
  'Marina Lopes: Começamos numa garagem em 2015, com duas máquinas de costura e muita teimosia.',
  'Entrevistadora: E o que mudou depois da feira de Novo Hamburgo?',
  'Marina Lopes: A feira mudou tudo. A gente saiu de lá com vinte lojistas novos e a certeza de que o couro reaproveitado tinha mercado.',
  'Entrevistadora: Qual é o próximo passo?',
  'Marina Lopes: Queremos abrir uma escola de ofício para jovens da região ainda este ano.',
].join('\n');

export type TestKit = {
  ctx: (actorId?: string) => CommandContext;
  advance: (ms?: number) => void;
  now: () => string;
};

export function createKit(start = '2026-10-07T12:00:00.000Z'): TestKit {
  let time = Date.parse(start);
  let counter = 0;
  return {
    ctx: (actorId = JOAO) => ({ now: new Date(time).toISOString(), newId: (prefix) => `${prefix}-${++counter}`, actorId }),
    advance: (ms = 60_000) => {
      time += ms;
    },
    now: () => new Date(time).toISOString(),
  };
}

export function sampleSource(kit: TestKit, authorized = true): Source {
  return createTranscriptSource(
    {
      workspaceId: WORKSPACE,
      title: 'Entrevista Ateliê Sul',
      origin: 'interview',
      parsed: parseTranscript(SAMPLE_TRANSCRIPT),
      authorized,
      speakerPeople: { 'Marina Lopes': 'person-marina' },
    },
    kit.ctx(),
  );
}

export function sampleArticle(source: Source): ArticleBody {
  const ref = (segment: string) => segmentRef(source.id, 1, segment);
  return {
    type: 'article',
    title: 'Da garagem à feira: a virada do Ateliê Sul',
    blocks: [
      paragraphBlock('b-intro', 'O Ateliê Sul nasceu numa garagem e hoje abastece vinte lojistas.', { ai: 'unreviewed', sourceRefs: [ref('seg-002')] }),
      headingBlock('b-h1', 'O começo', 2, { ai: 'unreviewed' }),
      paragraphBlock('b-p1', 'Marina Lopes lembra: “Começamos numa garagem em 2015, com duas máquinas de costura e muita teimosia.”', {
        ai: 'unreviewed',
        sourceRefs: [ref('seg-002')],
      }),
      quoteBlock('b-q1', 'A feira mudou tudo.', { ai: 'unreviewed', sourceRefs: [ref('seg-004')] }),
    ],
  };
}

export const TEMPLATE: CarouselTemplate = {
  id: 'tpl-cv-dark',
  name: 'Content Ventures escuro',
  width: 1080,
  height: 1350,
  minSlides: 3,
  maxSlides: 10,
  coverLayoutId: 'cover',
  layouts: [
    { id: 'cover', label: 'Capa', slots: [{ id: 'title', label: 'Título', role: 'title', maxChars: 60, required: true }] },
    { id: 'point', label: 'Ponto', slots: [{ id: 'title', label: 'Título', role: 'title', maxChars: 50 }, { id: 'body', label: 'Texto', role: 'body', maxChars: 180 }] },
    { id: 'quote', label: 'Citação', slots: [{ id: 'quote', label: 'Citação', role: 'quote', maxChars: 140, required: true }] },
    { id: 'closing', label: 'Conclusão', slots: [{ id: 'title', label: 'Título', role: 'title', maxChars: 60 }] },
  ],
};

export function sampleCarousel(): CarouselBody {
  return {
    type: 'carousel',
    templateId: TEMPLATE.id,
    slides: [
      { id: 's-1', layout: 'cover', slots: { title: 'Da garagem à feira' }, sourceBlockIds: ['b-intro'], ai: 'unreviewed' },
      { id: 's-2', layout: 'point', slots: { title: 'O começo', body: 'Duas máquinas e muita teimosia.' }, sourceBlockIds: ['b-p1'] },
      { id: 's-3', layout: 'quote', slots: { quote: 'A feira mudou tudo.' }, sourceBlockIds: ['b-q1'] },
      { id: 's-4', layout: 'closing', slots: { title: 'Próximo passo: uma escola de ofício' }, sourceBlockIds: [] },
    ],
  };
}

export function emptyPiece(kit: TestKit, productionId: string, kind: PieceKind, body: PieceBody): Piece {
  const ctx = kit.ctx();
  return {
    id: `piece-${kind}`,
    productionId,
    kind,
    slug: kind,
    draft: { body, revision: 0, inputs: [], sources: [], updatedAt: ctx.now, updatedBy: ctx.actorId },
    createdAt: ctx.now,
    createdBy: ctx.actorId,
  };
}

/** A production with an authorised source and empty article/carousel pieces. */
export function baseRecord(kit: TestKit, options: { plan?: PieceKind[]; authorized?: boolean } = {}): ProductionRecord {
  const source = sampleSource(kit, options.authorized ?? true);
  const ctx = kit.ctx();
  const production: Production = {
    id: 'prod-1',
    workspaceId: WORKSPACE,
    flowId: 'transcript-article',
    title: 'Entrevista Ateliê Sul',
    sourceIds: [source.id],
    brief: { sections: 3, size: 'standard', revision: 1 },
    plan: options.plan ?? ['article', 'carousel'],
    relations: [],
    ownerId: JOAO,
    createdAt: ctx.now,
    createdBy: JOAO,
    updatedAt: ctx.now,
  };
  const pieces = [emptyPiece(kit, production.id, 'article', { type: 'article', title: '', blocks: [] })];
  return {
    production,
    sources: [source],
    pieces,
    versions: [],
    decisions: [],
    reviewRequests: [],
    runs: [],
    suggestions: [],
    deliveries: [],
  };
}

export function pieceIn(record: ProductionRecord, kind: PieceKind): Piece {
  const piece = record.pieces.find((candidate) => candidate.kind === kind);
  if (!piece) throw new Error(`no ${kind} piece`);
  return piece;
}

function replacePiece(record: ProductionRecord, piece: Piece): void {
  record.pieces = record.pieces.map((candidate) => (candidate.id === piece.id ? piece : candidate));
}

/** Writes a body into the draft and freezes it as a version (mutates the record). */
export function commitVersion(
  record: ProductionRecord,
  kit: TestKit,
  kind: PieceKind,
  body: PieceBody,
  options: { origin?: Version['origin']; inputs?: VersionRef[]; interrupted?: boolean } = {},
): Version {
  kit.advance();
  const ctx = kit.ctx();
  let piece = pieceIn(record, kind);
  const updated = updateDraft(piece, body, piece.draft.revision, ctx);
  if (!updated.ok) throw new Error(updated.refusal.message);
  piece = updated.value;
  if (options.inputs) piece = { ...piece, draft: { ...piece.draft, inputs: options.inputs } };
  if (piece.draft.sources.length === 0) {
    piece = { ...piece, draft: { ...piece.draft, sources: record.sources.map((source) => toSourceVersionRef(source)) } };
  }
  const version = createVersion(
    { piece, versions: record.versions, origin: options.origin ?? 'edit', interrupted: options.interrupted },
    ctx,
  );
  record.versions = [...record.versions, version];
  replacePiece(record, draftFromVersion(piece, version, ctx));
  return version;
}

export function addCarouselPiece(record: ProductionRecord, kit: TestKit): Piece {
  const piece = emptyPiece(kit, record.production.id, 'carousel', { type: 'carousel', templateId: TEMPLATE.id, slides: [] });
  record.pieces = [...record.pieces, piece];
  return piece;
}

export function recordDecision(
  record: ProductionRecord,
  kit: TestKit,
  version: Version,
  decision: Decision['decision'],
  options: { by?: string; note?: string; gate?: GateDefinition; images?: ImageRightsRecord[] } = {},
): Decision {
  kit.advance();
  const ctx = kit.ctx(options.by ?? PEDRO);
  const piece = record.pieces.find((candidate) => candidate.id === version.pieceId);
  const gate = options.gate ?? (piece?.kind === 'carousel' ? CAROUSEL_GATE : ARTICLE_GATE);
  const entry: Decision = {
    id: ctx.newId('dec'),
    gate: gate.id,
    subject: toVersionRef(version),
    decision,
    by: ctx.actorId,
    at: ctx.now,
    checks: [],
  };
  if (options.note) entry.note = options.note;
  if (options.images) entry.images = options.images;
  record.decisions = [...record.decisions, entry];
  return entry;
}

export function requestReview(record: ProductionRecord, kit: TestKit, version: Version): void {
  kit.advance();
  const ctx = kit.ctx(JOAO);
  const piece = record.pieces.find((candidate) => candidate.id === version.pieceId);
  record.reviewRequests = [
    ...record.reviewRequests,
    {
      id: ctx.newId('rev'),
      gate: piece?.kind === 'carousel' ? CAROUSEL_GATE.id : ARTICLE_GATE.id,
      subject: toVersionRef(version),
      requestedBy: JOAO,
      requestedAt: ctx.now,
    },
  ];
}

/** Article approved at v1 and a carousel derived from it, approved too. */
export function approvedPackage(kit: TestKit): { record: ProductionRecord; article: Version; carousel: Version } {
  const record = baseRecord(kit);
  const article = commitVersion(record, kit, 'article', sampleArticle(record.sources[0]), { origin: 'generation' });
  recordDecision(record, kit, article, 'approved');
  addCarouselPiece(record, kit);
  const carousel = commitVersion(record, kit, 'carousel', sampleCarousel(), { origin: 'generation', inputs: [toVersionRef(article)] });
  recordDecision(record, kit, carousel, 'approved');
  return { record, article, carousel };
}
