import 'server-only';
import sharp from 'sharp';
import { z } from 'zod';
import type { ImageOrientation } from '../domain/article.ts';
import { imageDescription, imageGenerationPrompt, imageGenerationSize } from '../domain/image-generation.ts';
import { providerKey } from './config';
import { FlowError } from './errors';

/**
 * "Gerar com IA" on the server-owned OpenAI key (Images API, `gpt-image-1` unless
 * `REPORTER_IMAGE_MODEL` names another). Only the description and the editorial frame leave the
 * application; the image comes back as base64 and is decoded and re-encoded as a JPEG here, so
 * nothing the provider returns reaches storage unchecked.
 */

export type GeneratedPhoto = { bytes: Buffer; width: number; height: number };

const envelope = z.object({ data: z.array(z.object({ b64_json: z.string().min(1) })).min(1) });

export function imageModel() {
  return process.env.REPORTER_IMAGE_MODEL?.trim() || 'gpt-image-1';
}

async function readBody(response: Response, limit: number): Promise<string> {
  if (!response.body) throw new FlowError('IMAGE_GENERATION_FAILED', 502, true, 5);
  const reader = response.body.getReader(), parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > limit) { await reader.cancel(); throw new FlowError('IMAGE_GENERATION_FAILED', 502); }
      parts.push(part.value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(parts).toString('utf8');
}

export async function generateEditorialImage(input: { prompt: string; orientation?: ImageOrientation }, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<GeneratedPhoto> {
  const description = imageDescription(input.prompt);
  if (!description) throw new FlowError('INVALID_INPUT', 422);
  let key: string;
  try { key = providerKey('openai'); } catch { throw new FlowError('OPENAI_KEY_MISSING', 503); }
  let response: Response;
  try {
    response = await fetcher('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify({ model: imageModel(), prompt: imageGenerationPrompt(description), n: 1,
        size: imageGenerationSize(input.orientation), quality: 'medium', output_format: 'jpeg' }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(150000)]),
    });
  } catch {
    throw new FlowError(signal.aborted ? 'JOB_INTERRUPTED' : 'IMAGE_GENERATION_FAILED', 503, true, 5);
  }
  // Machine status only: the provider's message is never reflected or stored.
  if (response.status === 400) throw new FlowError('IMAGE_GENERATION_REFUSED', 422);
  if (response.status === 401 || response.status === 403) throw new FlowError('OPENAI_AUTH_INVALID', 503);
  if (!response.ok) throw new FlowError('IMAGE_GENERATION_FAILED', 502, true, 5);
  let encoded: string;
  try { encoded = envelope.parse(JSON.parse(await readBody(response, 30 * 1024 ** 2))).data[0].b64_json; }
  catch (error) { if (error instanceof FlowError) throw error; throw new FlowError('IMAGE_GENERATION_FAILED', 502, true, 5); }
  try {
    const result = await sharp(Buffer.from(encoded, 'base64'), { limitInputPixels: 40000000, animated: false })
      .jpeg({ quality: 88 }).toBuffer({ resolveWithObject: true });
    if (!result.info.width || !result.info.height || result.data.length > 10 * 1024 ** 2) throw new Error('size');
    return { bytes: result.data, width: result.info.width, height: result.info.height };
  } catch { throw new FlowError('IMAGE_GENERATION_FAILED', 502, true, 5); }
}
