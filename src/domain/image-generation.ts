import type { ImageOrientation, ImageSlot } from './article.ts';
import { normalizeImageRef } from './asset.ts';
import type { ImageRef } from './asset.ts';

/**
 * "Gerar com IA" (F6.10): what a person (or an image suggestion of the generation) describes and
 * what reaches the image provider. The description stays the person's; the provider also gets
 * the editorial frame: a realistic photo with no text or logos and no identifiable real person
 * (a name in a suggestion is context, never someone to portray).
 */

export const IMAGE_PROMPT_MAX = 1000;

export type ImageGenerationSize = '1536x1024' | '1024x1536' | '1024x1024';

/** Landscape unless the suggestion asks otherwise (the cover is 16:9). */
export function imageGenerationSize(orientation: ImageOrientation | undefined): ImageGenerationSize {
  return orientation === 'portrait' ? '1024x1536' : orientation === 'square' ? '1024x1024' : '1536x1024';
}

/** The description on one line, cut to the limit; empty when there is nothing to draw. */
export function imageDescription(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, IMAGE_PROMPT_MAX);
}

export function imageGenerationPrompt(description: string): string {
  return [
    'Fotografia editorial realista para ilustrar uma reportagem.',
    `Cena: ${imageDescription(description)}`,
    'Luz natural e composição limpa. Sem texto, letreiros legíveis, logotipos ou marca d’água.',
    'Não retrate pessoas reais identificáveis: nomes servem só de contexto; pessoas aparecem de costas, ao longe ou fora de foco.',
  ].join('\n');
}

/** How an image generated for a suggestion enters the text: its alt text and caption. */
export function slotImageRef(assetId: string, slot: ImageSlot): ImageRef {
  return normalizeImageRef({ assetId, alt: slot.suggestedAlt ?? slot.subject, caption: slot.suggestedCaption });
}
