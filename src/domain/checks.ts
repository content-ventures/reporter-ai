import { aiBlockIds, articleImages, articleLinks, articleStats, blockText, COVER_BLOCK_ID, findBlock, unreviewedAiBlockIds } from './article.ts';
import type { ArticleBody } from './article.ts';
import { creditLine, IMAGE_ISSUE_LABELS, imageAlt, imageIssues, NO_ASSETS } from './asset.ts';
import type { AssetLookup, ImageIssue, ImageRef } from './asset.ts';
import { DEFAULT_SLIDE_SEQUENCE, slotIssues } from './carousel.ts';
import type { CarouselBody, CarouselTemplate } from './carousel.ts';
import type { BlockId, CheckId } from './ids.ts';
import type { PieceKind } from './piece.ts';
import { LENGTH_TARGETS } from './production.ts';
import type { Brief } from './production.ts';
import { checkQuotes } from './quotes.ts';
import type { TextRange, VersionRef } from './refs.ts';
import type { Source } from './source.ts';
import { normalizeLink } from './text/links.ts';

/**
 * Readiness checks, a data-driven registry. Only "Geração concluída" blocks approval: the rest
 * are warnings because the human decides. The same results feed the studio status line, the
 * review side panel, the "Prontidão" meter and the snapshot stored with each decision.
 *
 * `info` is a neutral fact about an optional part ("Sem capa", D04): the row stays open with its
 * jump, but it is neither a warning nor part of the readiness count.
 */

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'na' | 'info';

export type CheckResult = {
  id: CheckId;
  label: string;
  status: CheckStatus;
  blocking: boolean;
  /** Short pt-BR detail: "812/800 palavras", "3 de 4 conferidas". */
  detail?: string;
  /** Meter value for MeterList ("citações conferidas 3/4"). */
  progress?: { current: number; total: number };
  /** Where to jump to fix it (next pending item first). */
  targets?: TextRange[];
};

export type GenerationState = {
  running: boolean;
  /** The draft is still the untouched output of an interrupted/failed generation. */
  interrupted: boolean;
};

export type ArticleCheckContext = {
  body: ArticleBody;
  brief: Brief;
  sources: readonly Source[];
  generation: GenerationState;
  /** Image metadata (credit, rights) from the AssetStore; without it every image reads as not found. */
  assets?: AssetLookup;
};

export type CarouselCheckContext = {
  body: CarouselBody;
  template?: CarouselTemplate;
  /** Parent versions this carousel was written from. */
  inputs: readonly VersionRef[];
  /** Latest approved article version, for "Versão do artigo". */
  latestApprovedParent?: VersionRef;
  generation: GenerationState;
  /** Cover of the article version the carousel was made from (layouts may draw it). */
  articleCover?: ImageRef;
  /** Image metadata (credit, rights) for "Imagem da capa". */
  assets?: AssetLookup;
};

export type CheckOutcome = Pick<CheckResult, 'status' | 'detail' | 'progress' | 'targets'>;

export type CheckDefinition<C> = {
  id: CheckId;
  label: string;
  pieceKind: PieceKind;
  blocking: boolean;
  evaluate: (context: C) => CheckOutcome;
};

function wholeBlock(body: ArticleBody, blockId: BlockId): TextRange {
  const block = findBlock(body, blockId);
  return { blockId, from: 0, to: block ? blockText(block).length : 0 };
}

/** Target of an image: the figure block, or the cover pseudo block (`COVER_BLOCK_ID`). */
function imageTarget(blockId: string): TextRange {
  return { blockId, from: 0, to: 0 };
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

const ISSUE_DETAIL: Record<ImageIssue, (count: number) => string> = {
  missing_credit: (count) => `${count} sem crédito`,
  not_authorized: (count) => `${count} sem uso autorizado`,
  missing_asset: (count) => countLabel(count, 'não encontrada', 'não encontradas'),
};

function generationCheck(generation: GenerationState): CheckOutcome {
  if (generation.running) return { status: 'fail', detail: 'Geração em andamento' };
  if (generation.interrupted) return { status: 'fail', detail: 'Geração interrompida: continue ou edite o texto' };
  return { status: 'pass' };
}

export const ARTICLE_CHECKS: readonly CheckDefinition<ArticleCheckContext>[] = [
  {
    id: 'article.title',
    label: 'Título',
    pieceKind: 'article',
    blocking: false,
    evaluate: ({ body }) => (body.title.trim() ? { status: 'pass' } : { status: 'warn', detail: 'Sem título' }),
  },
  {
    id: 'article.cover',
    label: 'Imagem de destaque',
    pieceKind: 'article',
    blocking: false,
    evaluate: ({ body, assets = NO_ASSETS }) => {
      // The cover is optional (D04): its absence is a neutral fact, not a warning.
      if (!body.cover) return { status: 'info', detail: 'Sem capa', targets: [imageTarget(COVER_BLOCK_ID)] };
      if (!assets(body.cover.assetId)) return { status: 'warn', detail: 'Imagem não encontrada neste navegador', targets: [imageTarget(COVER_BLOCK_ID)] };
      return { status: 'pass' };
    },
  },
  {
    id: 'article.length',
    label: 'Extensão no alvo',
    pieceKind: 'article',
    blocking: false,
    evaluate: ({ body, brief }) => {
      const target = LENGTH_TARGETS[brief.length];
      const { words } = articleStats(body);
      const detail = `${words}/${target.words} palavras`;
      const progress = { current: words, total: target.words };
      return words >= target.min && words <= target.max ? { status: 'pass', detail, progress } : { status: 'warn', detail, progress };
    },
  },
  {
    id: 'article.quotes',
    label: 'Citações conferidas',
    pieceKind: 'article',
    blocking: false,
    evaluate: ({ body, sources }) => {
      const checks = checkQuotes(body, sources);
      if (checks.length === 0) return { status: 'na', detail: 'Sem citações' };
      const verified = checks.filter((check) => check.status === 'verified').length;
      const missing = checks.filter((check) => check.status === 'missing').map((check) => check.range);
      const outcome: CheckOutcome = {
        status: missing.length === 0 ? 'pass' : 'warn',
        detail: `${verified} de ${checks.length} conferidas`,
        progress: { current: verified, total: checks.length },
      };
      if (missing.length > 0) outcome.targets = missing;
      return outcome;
    },
  },
  {
    id: 'article.ai-reviewed',
    label: 'Blocos da IA revisados',
    pieceKind: 'article',
    blocking: false,
    evaluate: ({ body }) => {
      const total = aiBlockIds(body).length;
      if (total === 0) return { status: 'na' };
      const pending = unreviewedAiBlockIds(body);
      const outcome: CheckOutcome = {
        status: pending.length === 0 ? 'pass' : 'warn',
        detail: `${total - pending.length} de ${total} revisados`,
        progress: { current: total - pending.length, total },
      };
      if (pending.length > 0) outcome.targets = pending.map((id) => wholeBlock(body, id));
      return outcome;
    },
  },
  {
    id: 'article.links',
    label: 'Links',
    pieceKind: 'article',
    blocking: false,
    evaluate: ({ body }) => {
      const links = articleLinks(body);
      if (links.length === 0) return { status: 'na' };
      const broken = links.filter((link) => !normalizeLink(link.href).ok);
      const outcome: CheckOutcome = {
        status: broken.length === 0 ? 'pass' : 'warn',
        detail: broken.length === 0 ? `${links.length} válidos` : `${broken.length} inválidos`,
        progress: { current: links.length - broken.length, total: links.length },
      };
      if (broken.length > 0) outcome.targets = broken.map((link) => wholeBlock(body, link.blockId));
      return outcome;
    },
  },
  {
    id: 'article.image-credits',
    label: 'Imagens com crédito',
    pieceKind: 'article',
    blocking: false,
    evaluate: ({ body, assets = NO_ASSETS }) => {
      const uses = articleImages(body);
      if (uses.length === 0) return { status: 'na', detail: 'Sem imagens' };
      // Credit and rights belong to the image: counted once per image, every use is a target.
      const issuesOf = new Map(uses.map((use) => [use.image.assetId, imageIssues(assets(use.image.assetId))]));
      const counts: Record<ImageIssue, number> = { missing_credit: 0, not_authorized: 0, missing_asset: 0 };
      for (const issues of issuesOf.values()) for (const issue of issues) counts[issue] += 1;
      const targets = uses.filter((use) => (issuesOf.get(use.image.assetId) ?? []).length > 0).map((use) => imageTarget(use.blockId));
      const pending = [...issuesOf.values()].filter((issues) => issues.length > 0).length;
      const progress = { current: issuesOf.size - pending, total: issuesOf.size };
      if (pending === 0) return { status: 'pass', detail: countLabel(issuesOf.size, 'imagem conferida', 'imagens conferidas'), progress };
      const order: ImageIssue[] = ['missing_asset', 'missing_credit', 'not_authorized'];
      const detail = order
        .filter((issue) => counts[issue] > 0)
        .map((issue) => ISSUE_DETAIL[issue](counts[issue]))
        .join(' · ');
      return { status: 'warn', detail, progress, targets };
    },
  },
  {
    id: 'article.image-alt',
    label: 'Texto alternativo',
    pieceKind: 'article',
    blocking: false,
    evaluate: ({ body }) => {
      const uses = articleImages(body);
      if (uses.length === 0) return { status: 'na', detail: 'Sem imagens' };
      const missing = uses.filter((use) => !imageAlt(use.image));
      const progress = { current: uses.length - missing.length, total: uses.length };
      if (missing.length === 0) return { status: 'pass', detail: countLabel(uses.length, 'imagem descrita', 'imagens descritas'), progress };
      return { status: 'warn', detail: `${missing.length} sem texto alternativo`, progress, targets: missing.map((use) => imageTarget(use.blockId)) };
    },
  },
  {
    id: 'article.generation',
    label: 'Geração concluída',
    pieceKind: 'article',
    blocking: true,
    evaluate: ({ generation }) => generationCheck(generation),
  },
];

export const CAROUSEL_CHECKS: readonly CheckDefinition<CarouselCheckContext>[] = [
  {
    id: 'carousel.template',
    label: 'Template',
    pieceKind: 'carousel',
    blocking: false,
    evaluate: ({ body, template }) =>
      template && template.id === body.templateId ? { status: 'pass', detail: template.name } : { status: 'warn', detail: 'Template não encontrado' },
  },
  {
    id: 'carousel.cover',
    label: 'Capa',
    pieceKind: 'carousel',
    blocking: false,
    evaluate: ({ body, template }) => {
      const cover = template?.coverLayoutId ?? DEFAULT_SLIDE_SEQUENCE[0];
      return body.slides[0]?.layout === cover ? { status: 'pass' } : { status: 'warn', detail: 'O primeiro slide não é a capa' };
    },
  },
  {
    id: 'carousel.cover-image',
    label: 'Imagem da capa',
    pieceKind: 'carousel',
    blocking: false,
    evaluate: ({ body, template, articleCover, assets = NO_ASSETS }) => {
      // Only when a slide's layout draws the article cover (template data decides).
      const drawn = body.slides.some((slide) => template?.layouts.find((layout) => layout.id === slide.layout)?.articleCover);
      if (!drawn || !articleCover) return { status: 'na' };
      const asset = assets(articleCover.assetId);
      // A linked cover is not drawn (the slide keeps the template colours): nothing to credit.
      if (asset?.origin.type === 'url') return { status: 'na', detail: 'Imagem por link: o slide usa as cores do modelo' };
      const issues = imageIssues(asset);
      if (asset && issues.length === 0) return { status: 'pass', detail: creditLine(asset.credit) };
      return { status: 'warn', detail: issues.map((issue) => IMAGE_ISSUE_LABELS[issue]).join(' · ') };
    },
  },
  {
    id: 'carousel.sequence',
    label: 'Ordem e quantidade',
    pieceKind: 'carousel',
    blocking: false,
    evaluate: ({ body, template }) => {
      const count = body.slides.length;
      const min = template?.minSlides ?? 3;
      const max = template?.maxSlides ?? 10;
      const detail = `${count} slides`;
      return count >= min && count <= max ? { status: 'pass', detail } : { status: 'warn', detail: `${detail} (entre ${min} e ${max})` };
    },
  },
  {
    id: 'carousel.limits',
    label: 'Limites de texto',
    pieceKind: 'carousel',
    blocking: false,
    evaluate: ({ body, template }) => {
      if (!template) return { status: 'na' };
      const issues = slotIssues(body, template);
      const affected = new Set(issues.map((issue) => issue.slideId));
      const ok = body.slides.length - affected.size;
      return {
        status: issues.length === 0 ? 'pass' : 'warn',
        detail: issues.length === 0 ? 'Todos os textos cabem' : issues[0].message,
        progress: { current: ok, total: body.slides.length },
      };
    },
  },
  {
    id: 'carousel.article-version',
    label: 'Versão do artigo',
    pieceKind: 'carousel',
    blocking: false,
    evaluate: ({ inputs, latestApprovedParent }) => {
      const used = inputs.find((input) => input.pieceId === latestApprovedParent?.pieceId) ?? inputs[0];
      if (!used) return { status: 'warn', detail: 'Sem versão de origem' };
      if (!latestApprovedParent || used.versionId === latestApprovedParent.versionId) {
        return { status: 'pass', detail: `Feito a partir da v${used.number}` };
      }
      return { status: 'warn', detail: `Feito a partir da v${used.number}; a aprovada é a v${latestApprovedParent.number}` };
    },
  },
  {
    id: 'carousel.generation',
    label: 'Geração concluída',
    pieceKind: 'carousel',
    blocking: true,
    evaluate: ({ generation }) => generationCheck(generation),
  },
];

export function runChecks<C>(definitions: readonly CheckDefinition<C>[], context: C): CheckResult[] {
  return definitions.map((definition) => ({
    id: definition.id,
    label: definition.label,
    blocking: definition.blocking,
    ...definition.evaluate(context),
  }));
}

export type Readiness = {
  /** Applicable checks that pass. */
  passed: number;
  /** Applicable checks (status ≠ na, info). */
  total: number;
  /** Blocking checks that fail: approval is disabled while this is non-empty. */
  blockers: CheckResult[];
  ready: boolean;
};

export function readiness(results: readonly CheckResult[]): Readiness {
  const applicable = results.filter((result) => result.status !== 'na' && result.status !== 'info');
  const blockers = results.filter((result) => result.blocking && result.status === 'fail');
  return {
    passed: applicable.filter((result) => result.status === 'pass').length,
    total: applicable.length,
    blockers,
    ready: blockers.length === 0,
  };
}
