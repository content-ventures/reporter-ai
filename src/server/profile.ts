import 'server-only';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import { AVATAR_SIDE, AVATAR_UPLOAD_MAX_BYTES, avatarPath, validateProfilePatch } from '../domain/profile.ts';
import { transaction } from './database.ts';
import { FlowError } from './errors.ts';
import { readImageFile, writeImageFile } from './image-storage.ts';

/**
 * "Meu perfil" over HTTP. The member is always the request's own identity: the SQL updates
 * `core.context_user_id()` only. Photos arrive already squared by the browser and are decoded,
 * turned upright, cropped and re-encoded here, so no EXIF (GPS) or foreign format is stored.
 */

const patchSchema = z.object({ name: z.string().max(400).optional(), title: z.string().max(400).nullable().optional(),
  avatar: z.null().optional() }).strict();
const AVATAR_FILE = /^[a-f0-9]{64}\.image$/;

export type StoredProfile = { name: string; title: string | null; image: string | null };

async function saveProfile(patch: Record<string, unknown>): Promise<StoredProfile> {
  return transaction('runtime', async client =>
    (await client.query('SELECT public.reporter_update_profile($1) AS value', [patch])).rows[0].value as StoredProfile);
}

/** Square WebP of `AVATAR_SIDE` px, upright and without metadata; refuses what is no image. */
export async function normalizeAvatar(bytes: Buffer): Promise<Buffer> {
  try {
    return await sharp(bytes, { limitInputPixels: 40_000_000 }).rotate()
      .resize(AVATAR_SIDE, AVATAR_SIDE, { fit: 'cover', position: 'attention' }).webp({ quality: 84 }).toBuffer();
  } catch { throw new FlowError('AVATAR_INVALID', 422); }
}

async function imageBody(request: Request): Promise<Buffer> {
  if (!request.headers.get('content-type')?.startsWith('image/')) throw new FlowError('AVATAR_INVALID', 415);
  if (!request.body) throw new FlowError('AVATAR_INVALID', 422);
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length;
      if (size > AVATAR_UPLOAD_MAX_BYTES) { await reader.cancel(); throw new FlowError('AVATAR_TOO_LARGE', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!size) throw new FlowError('AVATAR_INVALID', 422);
  return Buffer.concat(chunks);
}

const isWebp = (bytes: Buffer) => bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP';

export async function handleProfile(request: Request, path: string[], readJson: (request: Request) => Promise<unknown>): Promise<Response> {
  if (request.method === 'GET' && path.length === 2 && path[0] === 'avatar' && AVATAR_FILE.test(path[1])) {
    // Content-addressed in the caller's own portal, so the address never changes and caches forever.
    const bytes = await readImageFile(path[1]);
    if (!isWebp(bytes)) throw new FlowError('NOT_FOUND', 404);
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" } });
  }
  if (request.method !== 'POST') throw new FlowError('NOT_FOUND', 404);
  let patch: Record<string, unknown>;
  if (path.length === 0) {
    const input = patchSchema.parse(await readJson(request));
    const valid = validateProfilePatch({ name: input.name, title: input.title });
    if (!valid.ok) throw new FlowError(valid.refusal.code === 'empty_name' ? 'PROFILE_NAME_REQUIRED' : 'PROFILE_TOO_LONG', 422);
    patch = { ...valid.value, ...(input.avatar === null ? { image: null } : {}) };
  } else if (path.length === 1 && path[0] === 'avatar') {
    const bytes = await normalizeAvatar(await imageBody(request));
    const sha = createHash('sha256').update(bytes).digest('hex');
    await writeImageFile(`${sha}.image`, bytes, 'image/webp');
    patch = { image: avatarPath(sha) };
  } else throw new FlowError('NOT_FOUND', 404);
  return Response.json(await saveProfile(patch), { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
