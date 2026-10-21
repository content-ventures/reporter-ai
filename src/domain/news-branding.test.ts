import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newsLogoUrl } from './news-branding.ts';

test('publisher identity never sends article paths or query values to the image service', () => {
  const url = new URL(newsLogoUrl('https://www.opresenterural.com.br/pesca/segredo?token=private#text')!);
  assert.equal(url.searchParams.get('domain'), 'opresenterural.com.br');
  assert.equal(url.href.includes('private'), false);
  assert.equal(url.href.includes('segredo'), false);
  assert.equal(newsLogoUrl('https://agenciabrasil.ebc.com.br/noticias')?.includes('agenciabrasil.ebc.com.br'), true);
});

test('invalid and non-web addresses do not become external logo requests', () => {
  for (const value of ['not a URL', 'javascript:alert(1)', 'data:image/png,abc', 'https://user:password@portal.com'])
    assert.equal(newsLogoUrl(value), undefined);
});
