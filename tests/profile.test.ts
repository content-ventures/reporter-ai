import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { handleProfile, normalizeAvatar } from '../src/server/profile.ts';

const json = async (request: Request) => request.json();
const post = (path: string, body: BodyInit, type: string) => new Request(`http://127.0.0.1/api/reporter/profile/${path}`,
  { method: 'POST', headers: { 'content-type': type }, body });

test('a photo becomes an upright 512 px square WebP without metadata', async () => {
  // A landscape JPEG whose EXIF says "rotate 90°": stored as a portrait, upright, with no EXIF left.
  const photo = await sharp({ create: { width: 900, height: 600, channels: 3, background: '#3366cc' } })
    .jpeg().withMetadata({ orientation: 6, exif: { IFD0: { Copyright: 'GPS-like private data' } } }).toBuffer();
  const avatar = await normalizeAvatar(photo);
  const meta = await sharp(avatar).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.width, 512);
  assert.equal(meta.height, 512);
  assert.equal(meta.exif, undefined);
  assert.equal(meta.orientation, undefined);
  await assert.rejects(normalizeAvatar(Buffer.from('não é imagem')), /AVATAR_INVALID/);
});

test('the profile routes refuse bad input before touching the database', async () => {
  await assert.rejects(handleProfile(post('avatar', new Uint8Array(4 * 1024 * 1024 + 1), 'image/png'), ['avatar'], json), /AVATAR_TOO_LARGE/);
  await assert.rejects(handleProfile(post('avatar', '{}', 'application/json'), ['avatar'], json), /AVATAR_INVALID/);
  const patch = (body: unknown) => handleProfile(post('', JSON.stringify(body), 'application/json'), [], json);
  await assert.rejects(patch({ name: '   ' }), /PROFILE_NAME_REQUIRED/);
  await assert.rejects(patch({ title: 'a'.repeat(81) }), /PROFILE_TOO_LONG/);
  // Only name, cargo and removing the photo: never the e-mail, roles or someone else.
  await assert.rejects(patch({ name: 'Ana', email: 'ana@example.com' }), { name: 'ZodError' });
  await assert.rejects(patch({ avatar: '/api/reporter/profile/avatar/' + 'a'.repeat(64) + '.image' }), { name: 'ZodError' });
  await assert.rejects(handleProfile(new Request('http://127.0.0.1/api/reporter/profile/avatar/../x'), ['avatar', '..'], json), /NOT_FOUND/);
});
