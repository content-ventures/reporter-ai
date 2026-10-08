import type { ArticleBody } from '../../domain/article.ts';
import { headingBlock, paragraphBlock, quoteBlock } from '../../domain/article.ts';
import type { CarouselBody } from '../../domain/carousel.ts';
import type { PersonId, PieceId, ProductionId, SourceId } from '../../domain/ids.ts';
import type { PieceBody } from '../../domain/piece.ts';
import { segmentRef } from '../../domain/refs.ts';
import type { TextRange, VersionRef } from '../../domain/refs.ts';
import type { Result } from '../../domain/result.ts';
import type { SuggestionProposal } from '../../domain/suggestion.ts';
import type { FeedbackPort } from '../feedback.ts';
import type { NewProductionInput, ProductionCommands } from '../production-commands.ts';
import type { ProductionQueries } from '../production-queries.ts';
import type { SaveStatusPort } from '../save-status.ts';
import type { SessionPort } from '../session.ts';
import type { SourceIngest } from '../source-ingest.ts';

/**
 * What an adapter hands to the contract suites. A fresh, EMPTY workspace (no productions) per
 * call, with at least an editor/admin and an approver. Remote adapters implement `actAs` by
 * signing in as the test user and may omit the optional hooks (those tests are skipped).
 */
export type PortsUnderTest = {
  queries: ProductionQueries;
  commands: ProductionCommands;
  ingest: SourceIngest;
  session: SessionPort;
  feedback: FeedbackPort;
  saveStatus?: SaveStatusPort;
  people: {
    /** Roles editor + admin (may self-approve). */
    editor: PersonId;
    /** Role approver only. */
    approver: PersonId;
    /** Role editor only (cannot decide at gates). */
    editorOnly?: PersonId;
  };
  /** Carousel template id the adapter accepts. */
  carouselTemplateId: string;
  actAs(personId: PersonId): Promise<void>;
  /** Moves the adapter clock forward (simulated); remote adapters may wait instead. */
  advance(ms: number): Promise<void>;
  /** States only a generation service can create. Tests that need them are skipped without them. */
  simulate?: {
    /** Puts a generation run in progress on the piece; returns a function that finishes it. */
    activeRun?(pieceId: PieceId): Promise<() => Promise<void>>;
    /** Creates a ready AI suggestion on the piece draft. */
    suggestion?(pieceId: PieceId, input: { target: TextRange[]; proposal: SuggestionProposal; label?: string }): Promise<string>;
  };
  dispose?(): void | Promise<void>;
};

export type PortsFactory = () => PortsUnderTest | Promise<PortsUnderTest>;

/** Runs one test against a fresh adapter instance and disposes it. */
export async function withPorts(make: PortsFactory, test: (ports: PortsUnderTest) => Promise<void>): Promise<void> {
  const ports = await make();
  try {
    await test(ports);
  } finally {
    await ports.dispose?.();
  }
}

/** Fictional pt-BR interview used by every suite (never real people or meetings). */
export const CONTRACT_TRANSCRIPT = [
  'Repórter: Como nasceu a Cooperativa Vale Verde?',
  'Helena Duarte: Nasceu em 2019, quando doze famílias decidiram vender juntas o café que plantavam nas encostas.',
  'Repórter: O que mudou com a torrefação própria?',
  'Helena Duarte: A torrefação mudou a nossa margem. Antes a gente vendia o grão cru e ficava com quase nada do preço final.',
  'Repórter: Quais são os planos para o próximo ano?',
  'Helena Duarte: Queremos abrir uma cafeteria-escola na praça da cidade e formar baristas da própria comunidade.',
].join('\n');

export function unwrap<T>(result: Result<T, string>, context = 'command'): T {
  if (!result.ok) throw new Error(`${context} refused: ${result.refusal.code} (${result.refusal.message})`);
  return result.value;
}

export function newProductionInput(overrides: Partial<NewProductionInput> = {}): NewProductionInput {
  return {
    title: 'Cooperativa Vale Verde',
    material: { text: CONTRACT_TRANSCRIPT, origin: 'interview', authorized: true },
    brief: { sections: 3, length: 'short' },
    plan: ['article', 'carousel'],
    ...overrides,
  };
}

export type SampleProduction = { productionId: ProductionId; sourceId: SourceId; articleId: PieceId };

export async function createSample(ports: PortsUnderTest, overrides: Partial<NewProductionInput> = {}): Promise<SampleProduction> {
  const created = unwrap(await ports.commands.createFromSource(newProductionInput(overrides)), 'createFromSource');
  const article = created.pieces.find((piece) => piece.kind === 'article');
  if (!article) throw new Error('createFromSource must create the article piece');
  return { productionId: created.productionId, sourceId: created.sourceId, articleId: article.pieceId };
}

/** An article that cites the material by real segment ids (variant changes the wording). */
export async function sampleArticle(ports: PortsUnderTest, sourceId: SourceId, variant = 0): Promise<ArticleBody> {
  const detail = unwrap(await ports.queries.source(sourceId), 'source');
  const segments = detail.version.content.segments;
  const answer = (index: number) => segments.filter((segment) => segment.speaker === 'Helena Duarte')[index];
  const first = answer(0);
  const second = answer(1);
  const ref = (segmentId: string) => [segmentRef(sourceId, detail.version.number, segmentId)];
  return {
    type: 'article',
    title: variant === 0 ? 'O café que virou cooperativa' : `O café que virou cooperativa (${variant})`,
    blocks: [
      paragraphBlock('b-intro', `Doze famílias decidiram vender juntas o café das encostas${variant ? ` — revisão ${variant}` : ''}.`, {
        sourceRefs: first ? ref(first.id) : [],
      }),
      headingBlock('b-h1', 'A virada da torrefação', 2),
      quoteBlock('b-q1', 'A torrefação mudou a nossa margem.', { sourceRefs: second ? ref(second.id) : [] }),
    ],
  };
}

export function sampleCarousel(templateId: string, variant = 0): CarouselBody {
  return {
    type: 'carousel',
    templateId,
    slides: [
      { id: 's-1', layout: 'cover', slots: { title: variant ? `Do grão à xícara (${variant})` : 'Do grão à xícara' }, sourceBlockIds: ['b-intro'] },
      { id: 's-2', layout: 'quote', slots: { quote: 'A torrefação mudou a nossa margem.' }, sourceBlockIds: ['b-q1'] },
      { id: 's-3', layout: 'closing', slots: { title: 'Próximo passo: cafeteria-escola' }, sourceBlockIds: [] },
    ],
  };
}

/** Writes a body into the draft at its current revision. */
export async function writeDraft(ports: PortsUnderTest, pieceId: PieceId, body: PieceBody): Promise<number> {
  const draft = unwrap(await ports.queries.draft(pieceId), 'draft');
  return unwrap(await ports.commands.saveDraft(pieceId, body, draft.revision), 'saveDraft').revision;
}

/** Sends the piece to review and approves it as the approver; returns the approved ref. */
export async function approvePiece(ports: PortsUnderTest, pieceId: PieceId): Promise<VersionRef> {
  const requested = unwrap(await ports.commands.requestReview(pieceId), 'requestReview');
  await ports.actAs(ports.people.approver);
  const ref = requested.version.ref;
  unwrap(await ports.commands.decide({ pieceId, subject: ref, decision: 'approved', displayedHash: ref.hash }), 'decide');
  await ports.actAs(ports.people.editor);
  return ref;
}

/** Article written, reviewed and approved at v1. */
export async function approvedArticle(ports: PortsUnderTest): Promise<SampleProduction & { article: VersionRef }> {
  const sample = await createSample(ports);
  await writeDraft(ports, sample.articleId, await sampleArticle(ports, sample.sourceId));
  const article = await approvePiece(ports, sample.articleId);
  return { ...sample, article };
}
