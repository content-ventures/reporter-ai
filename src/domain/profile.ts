import { ok, refuse } from './result.ts';
import type { Result } from './result.ts';

/**
 * "Meu perfil": what a member edits about themselves. The name and the cargo (`title`) are free
 * text; the photo is a square image. E-mail, roles and workspace are never self-edited.
 */

/** `title: null` (or blank) clears the cargo. */
export type ProfilePatch = { name?: string; title?: string | null };

export type ProfileRefusal = 'empty_name' | 'too_long' | 'invalid_image' | 'unavailable' | 'read_only';

export const PROFILE_LIMITS = { name: 80, title: 80 } as const;

/** Side of the square photo, in px, in both runtimes. */
export const AVATAR_SIDE = 512;

/** Largest photo the server accepts once the browser has squared it. */
export const AVATAR_UPLOAD_MAX_BYTES = 4 * 1024 * 1024;

/** Where the connected runtime serves a member photo: content-addressed and immutable. */
export const AVATAR_PATH = /^\/api\/reporter\/profile\/avatar\/[a-f0-9]{64}\.image$/;

export function avatarPath(sha256: string): string {
  return `/api/reporter/profile/avatar/${sha256}.image`;
}

/** Shared account identity, with an explicit verified storage location. */
export function accountAvatarPath(personId: string, portalId: string, fileKey: string): string {
  if (![personId,portalId].every(value=>/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) || !/^[a-f0-9]{64}\.image$/.test(fileKey)) throw new Error('INVALID_AVATAR_ADDRESS');
  return `/api/reporter/avatars/${personId}/${portalId}/${fileKey}`;
}
export function accountAvatarSource(personId: string, image: string | undefined, legacyPortal: string): string | undefined {
  const match=/^\/api\/reporter\/profile\/avatar\/([a-f0-9]{64}\.image)$/.exec(image ?? '');
  if (!match) return image;
  try {return accountAvatarPath(personId,legacyPortal,match[1]);} catch {return undefined;}
}

/** Trimmed patch, with a blank cargo as `null`; refusals carry the pt-BR message. */
export function validateProfilePatch(patch: ProfilePatch): Result<ProfilePatch, 'empty_name' | 'too_long'> {
  const next: ProfilePatch = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim().replace(/\s+/g, ' ');
    if (!name) return refuse('empty_name', 'Informe seu nome.');
    if (name.length > PROFILE_LIMITS.name) return refuse('too_long', `Use até ${PROFILE_LIMITS.name} caracteres no nome.`);
    next.name = name;
  }
  if (patch.title !== undefined) {
    const title = patch.title?.trim().replace(/\s+/g, ' ') ?? '';
    if (title.length > PROFILE_LIMITS.title) return refuse('too_long', `Use até ${PROFILE_LIMITS.title} caracteres no cargo.`);
    next.title = title || null;
  }
  return ok(next);
}
