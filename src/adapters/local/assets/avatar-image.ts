import { validateImageFile } from '../../../domain/asset.ts';
import { AVATAR_SIDE, AVATAR_UPLOAD_MAX_BYTES } from '../../../domain/profile.ts';
import { ok, refuse } from '../../../domain/result.ts';
import type { Result } from '../../../domain/result.ts';
import type { AvatarInput } from '../../../ports/session.ts';
import { SNIFF_BYTES, sniffImage } from './image-sniff.ts';

/**
 * A profile photo, squared in the browser (centre crop, `AVATAR_SIDE` px, JPEG) with
 * `createImageBitmap` and `OffscreenCanvas`: no DOM element. Both runtimes store this result, so a
 * 12 MB phone photo becomes ~50 KB. Without a canvas (node), the checked original is kept when
 * it is small enough for the server.
 */

type Bitmap = { width: number; height: number; close?(): void };
type Context2D = {
  fillStyle: string;
  fillRect(x: number, y: number, width: number, height: number): void;
  drawImage(image: Bitmap, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number): void;
};
type Offscreen = { getContext(type: '2d'): Context2D | null; convertToBlob(options: { type: string; quality?: number }): Promise<Blob> };
type Platform = {
  createImageBitmap?: (blob: Blob) => Promise<Bitmap>;
  OffscreenCanvas?: new (width: number, height: number) => Offscreen;
};

async function square(file: Blob, platform: Platform): Promise<Blob | undefined> {
  const { createImageBitmap: decode, OffscreenCanvas: Canvas } = platform;
  if (!decode || !Canvas) return undefined;
  try {
    const bitmap = await decode(file);
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = new Canvas(AVATAR_SIDE, AVATAR_SIDE);
    const context = canvas.getContext('2d');
    if (!context || !side) return undefined;
    // JPEG has no transparency: a transparent logo sits on white, never on black.
    context.fillStyle = '#fff';
    context.fillRect(0, 0, AVATAR_SIDE, AVATAR_SIDE);
    context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, AVATAR_SIDE, AVATAR_SIDE);
    bitmap.close?.();
    return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.86 });
  } catch {
    return undefined;
  }
}

export async function avatarImage(input: AvatarInput, platform: Platform = globalThis as Platform): Promise<Result<Blob, 'invalid_image'>> {
  const check = validateImageFile({ name: input.fileName, type: input.file.type, size: input.file.size });
  if (!check.ok) return refuse('invalid_image', check.refusal.message);
  if (!sniffImage(new Uint8Array(await input.file.slice(0, SNIFF_BYTES).arrayBuffer()))) {
    return refuse('invalid_image', 'Este arquivo não é uma imagem JPG, PNG, WebP ou GIF.');
  }
  const squared = await square(input.file, platform);
  if (squared) return ok(squared);
  if (input.file.size <= AVATAR_UPLOAD_MAX_BYTES) return ok(input.file.type ? input.file : new Blob([input.file], { type: check.value.mime }));
  return refuse('invalid_image', 'Não foi possível ler esta imagem. Envie um JPG ou PNG de até 4 MB.');
}
