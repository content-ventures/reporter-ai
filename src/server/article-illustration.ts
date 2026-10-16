import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type { ArticleBody, ImageOrientation, ImageSlot, ImageSlotBlock } from '../domain/article.ts';
import { AI_IMAGE_CREDIT } from '../domain/asset.ts';
import type { ImageRef } from '../domain/asset.ts';
import { slotImageRef } from '../domain/image-generation.ts';
import type { ServerImageAsset } from '../ports/connected-workspace.ts';
import { currentReporterContext } from './request-context.ts';
import { generateEditorialImage } from './image-generation';
import type { GeneratedPhoto } from './image-generation';
import { writeImageFile } from './image-storage.ts';
import { safeCode } from './errors';

type Dependencies = {
  generate(input: { prompt: string; orientation?: ImageOrientation }, signal: AbortSignal): Promise<GeneratedPhoto>;
  store(fileKey: string, bytes: Buffer): Promise<void>;
};
const defaults: Dependencies = {
  generate: (input, signal) => generateEditorialImage(input, signal),
  store: (fileKey, bytes) => writeImageFile(fileKey, bytes, 'image/jpeg'),
};

/**
 * The article arrives illustrated: the cover suggestion and up to two figure suggestions are
 * generated with AI from what they describe, in parallel, and take their place with the
 * suggestion's alt text and caption, credited "Gerada com IA". A failed one stays a suggestion
 * (never an error); the text never changes.
 */
export async function illustrateArticle(body: ArticleBody,productionId: string,signal: AbortSignal,dependencies: Dependencies = defaults,identity?: {portal:string;actor:string}) {
  const attribution = identity ?? currentReporterContext();
  const result = structuredClone(body), assets: ServerImageAsset[] = [], codes = new Set<string>();
  const fill = async (slot: ImageSlot, orientation = slot.orientation): Promise<ImageRef | undefined> => {
    try {
      const photo = await dependencies.generate({ prompt: slot.subject,...(orientation ? { orientation } : {}) },signal);
      signal.throwIfAborted();
      const fileKey = createHash('sha256').update(photo.bytes).digest('hex')+'.image';
      await dependencies.store(fileKey,photo.bytes);
      const assetId = randomUUID();
      assets.push({ productionId,fileKey,asset: { id: assetId,workspaceId: attribution.portal,kind: 'image',origin: { type: 'generated',prompt: slot.subject },
        mime: 'image/jpeg',width: photo.width,height: photo.height,bytes: photo.bytes.length,credit: AI_IMAGE_CREDIT,
        rights: { authorized: true },createdAt: new Date().toISOString(),createdBy: attribution.actor } });
      return slotImageRef(assetId,slot);
    } catch (error) { if (signal.aborted) throw error; codes.add(safeCode(error)); return undefined; }
  };
  const figures = result.blocks.flatMap((block,index) => block.type === 'figure' && block.slot ? [index] : []).slice(0,2);
  const [cover,...images] = await Promise.all([
    result.coverSlot && !result.cover ? fill(result.coverSlot,'landscape') : undefined,
    ...figures.map(index => fill((result.blocks[index] as ImageSlotBlock).slot)),
  ]);
  if (cover) { result.cover = cover;delete result.coverSlot; }
  figures.forEach((index,i) => {
    const image = images[i];
    if (image) result.blocks[index] = { ...(result.blocks[index] as ImageSlotBlock),slot: undefined,image };
  });
  return { body: result,assets,filled: assets.length,codes: [...codes] };
}
