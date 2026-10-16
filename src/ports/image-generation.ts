import type { ImageOrientation } from '../domain/article.ts';
import type { ProductionId } from '../domain/ids.ts';
import type { Result } from '../domain/result.ts';

/**
 * "Gerar com IA" (F6.10): an image made from a description. The bytes come back to the caller,
 * which shows them and stores the one it keeps through `AssetStore.put` (`type: 'generated'`).
 * The connected runtime asks the server (its own provider key); the simulation answers with one of
 * the example's images, so the flow reads the same without a provider.
 */

/** The production the image is for (who may generate is checked against it). */
export type ImageGenerationInput = { productionId: ProductionId; prompt: string; orientation?: ImageOrientation };

export type GeneratedImage = { file: Blob };

/** `empty`: nothing to draw · `unavailable`: the provider failed or refused the description. */
export type ImageGenerationRefusal = 'empty' | 'unavailable';

export interface ImageGenerator {
  generate(input: ImageGenerationInput, signal?: AbortSignal): Promise<Result<GeneratedImage, ImageGenerationRefusal>>;
}
