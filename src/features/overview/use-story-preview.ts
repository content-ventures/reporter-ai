'use client';

import { blockText, creditLine, imageAlt } from '@/domain';
import type { InProgressItem } from '@/ports';
import { useAsset, useAssetUrl, usePiece, useProduction, useSimulation } from '@/state';

/** The saved article, never a generated summary or an invented illustration. */
export function useStoryPreview(item: InProgressItem) {
  const production = useProduction(item.productionId);
  const article = production.data?.pieces.find((piece) => piece.kind === 'article');
  const draft = usePiece(article?.id);
  const body = draft.data?.body.type === 'article' ? draft.data.body : undefined;
  const paragraph = body?.blocks.find((block) => block.type === 'paragraph' && blockText(block).trim());
  const figure = body?.blocks.find((block) => block.type === 'figure' && block.image);
  const image = body?.cover ?? (figure?.type === 'figure' ? figure.image : undefined);
  const asset = useAsset(image?.assetId);
  const url = useAssetUrl(image?.assetId);
  const simulation = useSimulation();
  const credit = asset.data ? creditLine(asset.data.credit) : undefined;
  const detail = production.data;
  const stage = detail?.stages.find((stage) => stage.id === detail.currentStageId);
  const currentPiece = detail?.pieces.find((piece) => piece.kind === stage?.pieceKind);

  return {
    title: body?.title.trim() || item.productionTitle,
    text: paragraph ? blockText(paragraph).replace(/\s+/g, ' ').trim() : undefined,
    simulated: simulation.available && Boolean(body?.title || paragraph) && Boolean(
      body?.blocks.some((block) => block.ai) || detail?.runs.some((run) => run.pieceId === article?.id && run.kind === 'article.generate'),
    ),
    image,
    src: url.data,
    alt: image ? imageAlt(image) : '',
    caption: image ? [image.caption, credit].filter(Boolean).join(' — ') || undefined : undefined,
    loading: production.status === 'loading' || Boolean(article && draft.status === 'loading'),
    imageLoading: Boolean(image && url.status === 'loading'),
    detail,
    stage,
    currentPiece,
  };
}

/** A short opening from the actual text, cut at a word boundary. */
export function storyOpening(text: string | undefined, limit: number): string | undefined {
  if (!text || text.length <= limit) return text;
  const cut = text.slice(0, limit);
  const space = cut.lastIndexOf(' ');
  return `${space > 0 ? cut.slice(0, space) : cut}…`;
}
