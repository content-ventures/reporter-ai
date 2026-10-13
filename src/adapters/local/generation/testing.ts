/**
 * Test harness for the simulated generation (not used by the app): a fictional pt-BR interview,
 * the real local store wired like the runtime (`watch` → `records.apply(applyRunUpdate)`), a
 * manual clock that sleeps instantly, and helpers to approve the article, add the carousel, send
 * a piece for approval and start the service a reload would (runs reopened from their snapshots).
 */
import type { CarouselTemplate } from '../../../domain/carousel.ts';
import { ARTICLE_GATE } from '../../../domain/decision.ts';
import type { Decision, ReviewRequest } from '../../../domain/decision.ts';
import type { ProductionId, RunId } from '../../../domain/ids.ts';
import { toVersionRef } from '../../../domain/piece.ts';
import type { Piece, PieceKind } from '../../../domain/piece.ts';
import type { Production } from '../../../domain/production.ts';
import type { ArticleSize } from '../../../domain/sizing.ts';
import { latestVersion, pieceOfKind } from '../../../domain/record.ts';
import type { ProductionRecord } from '../../../domain/record.ts';
import { ok } from '../../../domain/result.ts';
import type { RunEvent, RunFold } from '../../../domain/run-events.ts';
import { createTranscriptSource } from '../../../domain/source.ts';
import { parseTranscript } from '../../../domain/text/transcript-parse.ts';
import type { GenerationService } from '../../../ports/generation.ts';
import type { ScriptBook } from '../../../ports/script-book.ts';
import { createLocalStore } from '../store/local-store.ts';
import type { LocalStore } from '../store/local-store.ts';
import { createRecordAccess } from '../store/record-access.ts';
import { assembleRecord, findProduction, withProduction } from '../store/state.ts';
import { manualClock, sequentialIds } from '../store/system.ts';
import type { ManualClock } from '../store/system.ts';
import { createLocalGenerationService } from './local-generation.ts';
import { applyRunUpdate } from './record-sync.ts';
import type { SlotMeasure } from './carousel-assist.ts';
import type { Sleep } from './pacing.ts';

export const WORKSPACE_ID = 'ws-teste';
export const EDITOR = 'person-ana';
export const APPROVER = 'person-bruno';
export const PRODUCTION_ID = 'prod-padaria';
export const ARTICLE_PIECE = 'piece-article';
export const CAROUSEL_PIECE = 'piece-carousel';
export const TEMPLATE_ID = 'tpl-teste';

/** Fictional interview (three speakers, ~520 words): a neighbourhood bakery cooperative. */
export const INTERVIEW = [
  'Entrevistadora: Como começou a Padaria Fermento Vivo?',
  'Lúcia Prado: Começou em 2018, na cozinha da minha mãe, com um forno elétrico pequeno e uma lista de doze vizinhos que encomendavam pão toda sexta-feira. Eu fazia a massa de madrugada e entregava de bicicleta antes das sete.',
  'Entrevistadora: E quando virou cooperativa?',
  'Lúcia Prado: Em 2021 a gente reuniu nove padeiras do bairro que trabalhavam sozinhas. Ninguém conseguia comprar farinha em quantidade, então o preço sempre comia o lucro. Juntas, passamos a comprar direto do moinho e o custo do quilo caiu quase um terço.',
  'Rafael Nunes: Eu acompanhei a formalização como contador voluntário. O mais difícil não foi a papelada, foi convencer cada padeira de que dividir a compra não significava perder a própria receita. Cada uma continua com o seu pão, o que é comum é o insumo e a entrega.',
  'Entrevistadora: Como funciona a divisão do trabalho hoje?',
  'Lúcia Prado: Temos um forno coletivo alugado num galpão da associação de moradores. Cada padeira tem um turno de quatro horas, e a escala muda toda segunda-feira. A entrega é feita por dois jovens do bairro que recebem por rota.',
  'Rafael Nunes: A escala parece simples, mas é o que evita conflito. Quando o turno é transparente e a planilha fica pendurada na parede, ninguém sente que está trabalhando para o outro.',
  'Entrevistadora: Quais foram os maiores erros no caminho?',
  'Lúcia Prado: O primeiro erro foi aceitar encomenda de festa sem sinal. Perdemos três fornadas inteiras num mês porque os clientes desistiram na véspera. Hoje toda encomenda grande paga metade adiantado, sem exceção.',
  'Rafael Nunes: O segundo erro foi não separar o caixa da cooperativa do caixa de cada padeira. Levamos seis meses para arrumar as contas, e foi ali que todo mundo entendeu por que o contador insistia tanto.',
  'Entrevistadora: E os planos para o próximo ano?',
  'Lúcia Prado: Queremos abrir uma escola de panificação para jovens do bairro, com aulas aos sábados no próprio galpão. Já temos o forno, temos as professoras e temos a fila de interessados. Falta só a reforma da cozinha, que deve ficar pronta em março.',
  'Rafael Nunes: E a ideia é que a escola se pague com a venda do que os alunos produzem nas aulas, sem depender de doação.',
].join('\n');

/** Template structure used by tests (visual data lives with the fixtures). */
export const TEST_TEMPLATE: CarouselTemplate = {
  id: TEMPLATE_ID,
  name: 'Modelo de teste',
  width: 1080,
  height: 1350,
  minSlides: 3,
  maxSlides: 8,
  coverLayoutId: 'cover',
  layouts: [
    { id: 'cover', label: 'Capa', slots: [{ id: 'kicker', label: 'Chamada', role: 'kicker', maxChars: 32 }, { id: 'title', label: 'Título', role: 'title', maxChars: 70, required: true }] },
    { id: 'context', label: 'Contexto', slots: [{ id: 'title', label: 'Título', role: 'title', maxChars: 40 }, { id: 'body', label: 'Texto', role: 'body', maxChars: 200, required: true }] },
    { id: 'point', label: 'Ponto principal', slots: [{ id: 'title', label: 'Título', role: 'title', maxChars: 40, required: true }, { id: 'body', label: 'Texto', role: 'body', maxChars: 200 }] },
    { id: 'quote', label: 'Citação', slots: [{ id: 'quote', label: 'Citação', role: 'quote', maxChars: 140, required: true }, { id: 'attribution', label: 'Crédito', role: 'attribution', maxChars: 60 }] },
    {
      id: 'closing',
      label: 'Conclusão',
      slots: [
        { id: 'title', label: 'Título', role: 'title', maxChars: 50, required: true },
        { id: 'body', label: 'Texto', role: 'body', maxChars: 160 },
        { id: 'cta', label: 'Chamada final', role: 'cta', maxChars: 32 },
      ],
    },
  ],
};

export type HarnessOptions = {
  transcript?: string;
  authorized?: boolean;
  sections?: number;
  size?: ArticleSize;
  plan?: PieceKind[];
  scripts?: ScriptBook;
  /** Without the store sync the service only streams (nothing is settled). */
  sync?: boolean;
  /** Line fit of carousel slots (what `RenderService.measure` reports in the app). */
  measure?: SlotMeasure;
};

export type Harness = {
  clock: ManualClock;
  store: LocalStore;
  service: GenerationService;
  record(): ProductionRecord;
  /** Approves the latest article version (as the approver). */
  approveLatestArticle(): Decision;
  /** Adds the carousel piece (what `derive` does) for the test template. */
  addCarouselPiece(): Piece;
  /** "Enviar para aprovação" of the latest version of a piece (default the article), as the editor. */
  requestReview(options?: { pieceId?: string; assigneeId?: string }): ReviewRequest;
  /**
   * The service a reload starts: same store, no live run, earlier runs reopened from their
   * persisted stream snapshots (what the runtime wires as `persistedFold`).
   */
  reload(): GenerationService;
  /** Waits for the end of a run and returns every event and the final fold. */
  finish(runId: RunId): Promise<{ events: RunEvent[]; fold: RunFold }>;
};

/** Instant sleep that moves the manual clock, so durations and timestamps stay realistic. */
export function instantSleep(clock: ManualClock): Sleep {
  return async (ms) => {
    clock.advance(Math.max(0, Math.round(ms)));
  };
}

export function createHarness(options: HarnessOptions = {}): Harness {
  const clock = manualClock('2026-10-07T12:00:00.000Z');
  const ids = sequentialIds();
  const ctx = { now: clock.now(), newId: (prefix: string) => `seed-${prefix}`, actorId: EDITOR };
  const source = createTranscriptSource(
    {
      workspaceId: WORKSPACE_ID,
      title: 'Entrevista Padaria Fermento Vivo',
      origin: 'interview',
      parsed: parseTranscript(options.transcript ?? INTERVIEW),
      authorized: options.authorized ?? true,
    },
    ctx,
  );
  const production: Production = {
    id: PRODUCTION_ID,
    workspaceId: WORKSPACE_ID,
    flowId: 'transcript-article',
    title: 'Padaria Fermento Vivo',
    sourceIds: [source.id],
    brief: { sections: options.sections ?? 3, size: options.size ?? 'standard', revision: 1 },
    plan: options.plan ?? ['article', 'carousel'],
    relations: [],
    ownerId: EDITOR,
    createdAt: ctx.now,
    createdBy: EDITOR,
    updatedAt: ctx.now,
  };
  const article: Piece = {
    id: ARTICLE_PIECE,
    productionId: PRODUCTION_ID,
    kind: 'article',
    slug: 'article',
    draft: { body: { type: 'article', title: '', blocks: [] }, revision: 0, inputs: [], sources: [], updatedAt: ctx.now, updatedBy: EDITOR },
    createdAt: ctx.now,
    createdBy: EDITOR,
  };
  const store = createLocalStore({
    clock,
    ids,
    seed: () => ({
      workspace: { id: WORKSPACE_ID, name: 'Teste', slug: 'teste', createdAt: ctx.now },
      people: [
        { id: EDITOR, name: 'Ana Teste' },
        { id: APPROVER, name: 'Bruno Teste' },
      ],
      members: [
        { workspaceId: WORKSPACE_ID, personId: EDITOR, roles: ['editor', 'admin'] },
        { workspaceId: WORKSPACE_ID, personId: APPROVER, roles: ['approver'] },
      ],
      records: [
        { production, sources: [source], pieces: [article], versions: [], decisions: [], reviewRequests: [], runs: [], suggestions: [], deliveries: [] },
      ],
    }),
  });
  const record = (): ProductionRecord => {
    const found = findProduction(store.state, PRODUCTION_ID);
    if (!found) throw new Error('test production missing');
    return assembleRecord(store.state, found);
  };
  const createService = (persisted: boolean) =>
    createLocalGenerationService({
      clock,
      ids,
      getRecord: (productionId: ProductionId) => {
        const found = findProduction(store.state, productionId);
        return found ? assembleRecord(store.state, found) : undefined;
      },
      actorId: () => EDITOR,
      templates: () => [TEST_TEMPLATE],
      people: () => store.state.people,
      sleep: instantSleep(clock),
      ...(options.scripts ? { scripts: options.scripts } : {}),
      ...(options.measure ? { measure: options.measure } : {}),
      ...(persisted ? { persistedFold: (runId: RunId) => store.state.runFolds[runId] } : {}),
    });
  const sync = (generation: GenerationService) => {
    if (options.sync === false) return;
    const records = createRecordAccess(store);
    generation.watch((update) => {
      records.apply(update.meta.productionId, (current, context) => applyRunUpdate(current, update, context), { runFold: update.fold });
    });
  };
  const service = createService(false);
  sync(service);

  const mutate = (change: (production: NonNullable<ReturnType<typeof findProduction>>) => NonNullable<ReturnType<typeof findProduction>>) => {
    store.transact((state) => {
      const found = findProduction(state, PRODUCTION_ID);
      if (!found) throw new Error('test production missing');
      return ok({ state: withProduction(state, change(found)), value: true, persist: 'none' as const });
    });
  };

  return {
    clock,
    store,
    service,
    record,
    approveLatestArticle() {
      const current = record();
      const piece = pieceOfKind(current, 'article');
      const version = piece ? latestVersion(current, piece.id) : undefined;
      if (!version) throw new Error('no article version to approve');
      clock.advance(60_000);
      const decision: Decision = {
        id: `dec-${version.id}`,
        gate: ARTICLE_GATE.id,
        subject: toVersionRef(version),
        decision: 'approved',
        by: APPROVER,
        at: clock.now(),
        checks: [],
      };
      mutate((production) => ({ ...production, decisions: [...production.decisions, decision] }));
      return decision;
    },
    requestReview(request = {}) {
      const current = record();
      const pieceId = request.pieceId ?? ARTICLE_PIECE;
      const version = latestVersion(current, pieceId);
      if (!version) throw new Error('no version to send');
      clock.advance(60_000);
      const piece = current.pieces.find((entry) => entry.id === pieceId);
      const sent: ReviewRequest = {
        id: `req-${version.id}`,
        gate: piece?.kind === 'carousel' ? 'carousel.approval' : ARTICLE_GATE.id,
        subject: toVersionRef(version),
        requestedBy: EDITOR,
        requestedAt: clock.now(),
        ...(request.assigneeId ? { assigneeId: request.assigneeId } : {}),
      };
      mutate((production) => ({ ...production, reviewRequests: [...production.reviewRequests, sent] }));
      return sent;
    },
    reload() {
      const reloaded = createService(true);
      sync(reloaded);
      return reloaded;
    },
    addCarouselPiece() {
      const piece: Piece = {
        id: CAROUSEL_PIECE,
        productionId: PRODUCTION_ID,
        kind: 'carousel',
        slug: 'carousel',
        draft: { body: { type: 'carousel', templateId: TEMPLATE_ID, slides: [] }, revision: 0, inputs: [], sources: [], updatedAt: clock.now(), updatedBy: EDITOR },
        createdAt: clock.now(),
        createdBy: EDITOR,
      };
      mutate((production) => ({ ...production, pieces: [...production.pieces.filter((entry) => entry.id !== piece.id), piece] }));
      return piece;
    },
    async finish(runId) {
      const attached = await service.attach(runId);
      if (!attached.ok) throw new Error(attached.refusal.message);
      const events: RunEvent[] = [];
      for await (const event of attached.value.events) events.push(event);
      const again = await service.attach(runId);
      if (!again.ok) throw new Error(again.refusal.message);
      return { events, fold: again.value.snapshot };
    },
  };
}
