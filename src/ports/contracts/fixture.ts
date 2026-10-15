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
    /** Roles editor + creative_reviewer (decides carousels only). */
    creativeReviewer?: PersonId;
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
  /** The server applies the R1 article rules before a send, so sample articles must meet them. */
  enforcesR1Articles?: boolean;
  /** The server checks input shape and roles before the engine; those refusals carry its codes. */
  validatesBeforeEngine?: boolean;
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
    brief: { sections: 3, size: 'standard' },
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

// Unquoted context that brings a sample to the R1 limits (2.500–4.000 characters, 500–800 words).
const R1_CONTEXT = [
  'A cooperativa reúne hoje produtores de três comunidades rurais, que dividem a mesma estrutura de secagem, armazenamento e transporte. A organização coletiva permitiu negociar preços melhores com fornecedores de insumos e reduzir perdas na colheita. Cada família continua responsável pela própria lavoura, mas as decisões sobre investimentos passam por uma assembleia mensal aberta a todos os associados.',
  'Antes da torrefação própria, o grão saía da região sem identificação de origem e era misturado a lotes de outras procedências. Com a mudança, cada saca passou a ter rastreio por talhão, data de colheita e método de secagem. Essa informação aparece na embalagem e ajuda a explicar ao consumidor por que o café de encosta tem sabor diferente.',
  'O processo de torra é feito em pequenos lotes, em um galpão alugado na entrada da cidade. Dois jovens da comunidade foram treinados para operar o torrador e acompanhar as curvas de temperatura em planilhas simples. A cooperativa registra cada lote e guarda amostras para comparar resultados ao longo do ano.',
  'A venda direta mudou a relação com os clientes. Parte da produção segue para cafeterias da capital, que compram volumes fixos todos os meses, e outra parte é vendida em feiras regionais. Os associados contam que o contato com quem prepara o café trouxe sugestões práticas, como embalagens menores e moagens específicas.',
  'Os desafios ainda são grandes. O custo do frete encarece as entregas para cidades distantes, e a cooperativa depende de um único torrador, o que cria risco em caso de manutenção. Para reduzir essa dependência, o grupo estuda uma parceria com uma escola técnica da região, que poderia ceder equipamento e espaço para aulas práticas.',
  'A cafeteria-escola planejada para a praça central deve funcionar também como ponto de venda e vitrine da produção local. A ideia é oferecer cursos curtos de preparo, degustação e atendimento, com turmas pequenas e horários compatíveis com a rotina de quem trabalha na lavoura. O projeto ainda depende de autorização da prefeitura.',
  'Para os associados mais antigos, a principal conquista foi permanecer no campo com renda estável. Muitas famílias viam os filhos partirem para outras cidades em busca de trabalho, e agora parte desses jovens encontra ocupação na própria cooperativa, seja na torra, na logística ou no atendimento aos clientes.',
  'A colheita continua manual nas áreas mais íngremes, onde máquinas não conseguem entrar. Os grupos de colhedores se revezam ao longo das semanas e escolhem apenas os frutos maduros, o que aumenta o trabalho, mas melhora a bebida. Depois da colheita, o café descansa em terreiros cobertos e é revirado várias vezes ao dia.',
  'A cooperativa também investiu em formação. Técnicos visitam as propriedades a cada estação para orientar o manejo do solo, a poda e o controle de pragas com menos defensivos. As famílias anotam o que aplicam em cada talhão, e esse histórico ajuda a planejar a safra seguinte e a responder às perguntas dos compradores.',
];

/** An article that cites the material by real segment ids (variant changes the wording). */
export async function sampleArticle(ports: PortsUnderTest, sourceId: SourceId, variant = 0): Promise<ArticleBody> {
  const detail = unwrap(await ports.queries.source(sourceId), 'source');
  const segments = detail.version.content.segments;
  const answer = (index: number) => segments.filter((segment) => segment.speaker === 'Helena Duarte')[index];
  const first = answer(0);
  const second = answer(1);
  const third = answer(2);
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
      ...(ports.enforcesR1Articles ? [
        ...R1_CONTEXT.map((text, index) => paragraphBlock(`b-r1-${index}`, text)),
        quoteBlock('b-q2', 'Queremos abrir uma cafeteria-escola na praça da cidade e formar baristas da própria comunidade.', {
          sourceRefs: third ? ref(third.id) : [],
        }),
      ] : []),
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

/** First name of a person as the adapter knows it ("Pedro" for "Com Pedro"). */
export async function firstNameOf(ports: PortsUnderTest, personId: PersonId): Promise<string> {
  const person = (await ports.queries.people()).find((entry) => entry.id === personId);
  if (!person) throw new Error(`unknown person ${personId}`);
  return person.name.trim().split(/\s+/)[0] ?? person.name;
}

/** `YYYY-MM-DD` of the adapter's "today", read from an instant it stamped (a request's `requestedAt`). */
export function localDay(instant: string, offsetDays = 0): string {
  const date = new Date(Date.parse(instant));
  date.setDate(date.getDate() + offsetDays);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
