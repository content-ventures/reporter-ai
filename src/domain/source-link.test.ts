import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { captionsToSrt, parseSourceLink, sourceLinkMessage, sourceTitleScore } from './source-link.ts';

describe('source links', () => {
  test('normalizes supported YouTube URLs', () => {
    assert.deepEqual(parseSourceLink('https://youtu.be/7GeFt8suV8E?t=12'), {
      provider: 'youtube', id: '7GeFt8suV8E', url: 'https://www.youtube.com/watch?v=7GeFt8suV8E',
    });
    assert.equal(parseSourceLink('https://www.youtube.com/shorts/7GeFt8suV8E')?.id, '7GeFt8suV8E');
  });

  test('accepts only Spotify episodes, including localized paths and short links', () => {
    assert.deepEqual(parseSourceLink('https://open.spotify.com/intl-pt/episode/7makk4oTQel546B0PZlDM5?si=x'), {
      provider: 'spotify', id: '7makk4oTQel546B0PZlDM5', url: 'https://open.spotify.com/episode/7makk4oTQel546B0PZlDM5',
    });
    assert.equal(parseSourceLink('https://spotify.link/example')?.provider, 'spotify');
    assert.equal(parseSourceLink('https://open.spotify.com/show/7makk4oTQel546B0PZlDM5'), undefined);
  });

  test('rejects other hosts and explains the accepted sources', () => {
    assert.equal(parseSourceLink('http://youtube.com/watch?v=7GeFt8suV8E'), undefined);
    assert.equal(parseSourceLink('https://example.com/watch?v=7GeFt8suV8E'), undefined);
    assert.equal(sourceLinkMessage(''), 'Cole o link do vídeo ou episódio.');
    assert.equal(sourceLinkMessage('https://example.com'), 'Use um vídeo do YouTube ou um episódio do Spotify.');
  });

  test('formats captions and matches an episode title without accents or punctuation', () => {
    assert.equal(captionsToSrt([{ start: '1.12', dur: '4.56', text: 'Primeira fala' }]),
      '1\n00:00:01,120 --> 00:00:05,680\nPrimeira fala');
    assert.equal(sourceTitleScore('Gestão do pescado: inovação e varejo', 'Gestão do pescado — inovação e varejo'), 1);
    assert.ok(sourceTitleScore('Gestão do pescado no varejo', 'Política internacional') < 0.2);
  });
});
