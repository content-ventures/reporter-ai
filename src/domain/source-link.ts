export type SourceLinkProvider = 'youtube' | 'spotify';

export type ParsedSourceLink = {
  provider: SourceLinkProvider;
  url: string;
  id?: string;
};

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;

function httpsUrl(value: string): URL | undefined {
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' && !url.username && !url.password ? url : undefined;
  } catch {
    return undefined;
  }
}

/** YouTube videos and Spotify podcast episodes accepted by Nova produção. */
export function parseSourceLink(value: string): ParsedSourceLink | undefined {
  const url = httpsUrl(value);
  if (!url) return undefined;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');

  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0];
    return id && YOUTUBE_ID.test(id) ? { provider: 'youtube', id, url: `https://www.youtube.com/watch?v=${id}` } : undefined;
  }
  if (['youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)) {
    const parts = url.pathname.split('/').filter(Boolean);
    const id = url.pathname === '/watch' ? url.searchParams.get('v') : ['shorts', 'live', 'embed'].includes(parts[0] ?? '') ? parts[1] : undefined;
    return id && YOUTUBE_ID.test(id) ? { provider: 'youtube', id, url: `https://www.youtube.com/watch?v=${id}` } : undefined;
  }
  if (host === 'spotify.link') return { provider: 'spotify', url: url.toString() };
  if (host === 'open.spotify.com') {
    const parts = url.pathname.split('/').filter(Boolean);
    const episode = parts[0] === 'intl-pt' || /^intl-[a-z]{2}$/i.test(parts[0] ?? '') ? parts.slice(1) : parts;
    const id = episode[0] === 'episode' ? episode[1] : undefined;
    return id && SPOTIFY_ID.test(id) ? { provider: 'spotify', id, url: `https://open.spotify.com/episode/${id}` } : undefined;
  }
  return undefined;
}

export function sourceLinkMessage(value: string): string | undefined {
  if (!value.trim()) return 'Cole o link do vídeo ou episódio.';
  return parseSourceLink(value) ? undefined : 'Use um vídeo do YouTube ou um episódio do Spotify.';
}

export type TimedCaption = { start: string; dur: string; text: string };

function seconds(value: string): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function timestamp(value: number): string {
  const ms = Math.max(0, Math.round(value * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  return [h, m, s].map((item) => String(item).padStart(2, '0')).join(':') + ',' + String(ms % 1000).padStart(3, '0');
}

export function captionsToSrt(captions: readonly TimedCaption[]): string {
  return captions.map((item, index) => {
    const start = seconds(item.start), end = start + Math.max(0.05, seconds(item.dur));
    return `${index + 1}\n${timestamp(start)} --> ${timestamp(end)}\n${item.text.trim()}`;
  }).filter((block) => !block.endsWith('\n')).join('\n\n');
}

function folded(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR').replace(/[^a-z0-9]+/g, ' ').trim();
}

export function sourceTitleScore(wanted: string, candidate: string): number {
  const a = folded(wanted), b = folded(candidate);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (Math.min(a.length, b.length) >= 12 && (a.includes(b) || b.includes(a))) return 0.9;
  const left = new Set(a.split(' ').filter((word) => word.length > 2));
  const right = new Set(b.split(' ').filter((word) => word.length > 2));
  const shared = [...left].filter((word) => right.has(word)).length;
  return left.size + right.size ? (2 * shared) / (left.size + right.size) : 0;
}
