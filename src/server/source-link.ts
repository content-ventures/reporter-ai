import 'server-only';
import { getVideoDetails } from 'youtube-caption-extractor';
import { z } from 'zod';
import { MAX_TEXT_BYTES } from '../domain/reporter';
import { captionsToSrt, parseSourceLink, sourceTitleScore } from '../domain/source-link';
import { FlowError } from './errors';
import { receiveRemoteFile } from './storage';

const OEmbed = z.object({ title: z.string().min(1).max(500) }).passthrough();
const AppleEpisode = z.object({
  trackName: z.string(),
  collectionName: z.string().optional(),
  episodeUrl: z.string().url(),
  episodeFileExtension: z.string().optional(),
  trackTimeMillis: z.number().optional(),
}).passthrough();
const AppleSearch = z.object({ results: z.array(AppleEpisode) }).passthrough();

function safeName(value: string, extension: string): string {
  const stem = value.normalize('NFC').replace(/[\x00-\x1f\x7f-\x9f/\\:*?"<>|]/g,' ').replace(/\s+/g,' ').trim().slice(0,200) || 'episodio';
  return stem+extension;
}

async function spotifyCanonical(value: string, signal: AbortSignal): Promise<string> {
  const parsed = parseSourceLink(value);
  if (!parsed || parsed.provider!=='spotify') throw new FlowError('SOURCE_LINK_INVALID',422);
  if (parsed.id) return parsed.url;
  const response = await fetch(parsed.url,{ redirect: 'follow',signal });
  await response.body?.cancel().catch(() => {});
  const resolved = parseSourceLink(response.url);
  if (!resolved?.id || resolved.provider!=='spotify') throw new FlowError('SOURCE_LINK_INVALID',422);
  return resolved.url;
}

async function spotifyEpisode(value: string, signal: AbortSignal) {
  const sourceUrl = await spotifyCanonical(value,signal);
  const embedResponse = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(sourceUrl)}`,{ signal });
  if (!embedResponse.ok) throw new FlowError('SPOTIFY_EPISODE_NOT_FOUND',422);
  const embed = OEmbed.parse(await embedResponse.json());
  const search = async (country: string) => {
    const params = new URLSearchParams({ media: 'podcast',entity: 'podcastEpisode',country,limit: '50',term: embed.title });
    const response = await fetch(`https://itunes.apple.com/search?${params}`,{ signal });
    if (!response.ok) throw new FlowError('SPOTIFY_EPISODE_NOT_FOUND',422);
    return AppleSearch.parse(await response.json()).results;
  };
  const brazil = await search('BR');
  const results = brazil.some(item => sourceTitleScore(embed.title,item.trackName)>=0.72) ? brazil : [...brazil,...await search('US')];
  const ranked = results.map(item => ({ item,score: sourceTitleScore(embed.title,item.trackName) })).sort((a,b) => b.score-a.score);
  const best = ranked[0];
  if (!best || best.score<0.72) throw new FlowError('SPOTIFY_EPISODE_NOT_FOUND',422);
  if ((best.item.trackTimeMillis ?? 0)>3*60*60*1000) throw new FlowError('MEDIA_DURATION',422);
  const extension = ['mp3','m4a','mp4','wav','ogg','flac','webm'].includes((best.item.episodeFileExtension ?? '').toLowerCase())
    ? '.'+(best.item.episodeFileExtension ?? '').toLowerCase() : '.mp3';
  const file = await receiveRemoteFile(best.item.episodeUrl,safeName(best.item.trackName,extension),signal);
  return { kind: 'processing' as const,provider: 'spotify' as const,sourceUrl,title: best.item.trackName,
    programName: best.item.collectionName,file };
}

async function youtubeVideo(value: string, signal: AbortSignal) {
  const parsed = parseSourceLink(value);
  if (!parsed?.id || parsed.provider!=='youtube') throw new FlowError('SOURCE_LINK_INVALID',422);
  let details;
  try { details = await getVideoDetails({ videoID: parsed.id,lang: 'pt',fetch: (input,init) => fetch(input,{ ...init,signal }) }); }
  catch { throw new FlowError('YOUTUBE_VIDEO_UNAVAILABLE',422); }
  if (!details.subtitles.length) throw new FlowError('YOUTUBE_CAPTIONS_UNAVAILABLE',422);
  const text = captionsToSrt(details.subtitles);
  const bytes = Buffer.byteLength(text,'utf8');
  if (!text.trim() || bytes>MAX_TEXT_BYTES) throw new FlowError(bytes>MAX_TEXT_BYTES ? 'TEXT_TOO_LARGE' : 'INVALID_TRANSCRIPT',422);
  return { kind: 'ready' as const,provider: 'youtube' as const,sourceUrl: parsed.url,title: details.title,
    programName: 'YouTube',fileName: safeName(details.title,'.srt'),text,bytes };
}

export async function ingestSourceLink(value: string, signal: AbortSignal) {
  const parsed = parseSourceLink(value);
  if (!parsed) throw new FlowError('SOURCE_LINK_INVALID',422);
  const bounded = AbortSignal.any([signal,AbortSignal.timeout(10*60*1000)]);
  return parsed.provider==='youtube' ? youtubeVideo(parsed.url,bounded) : spotifyEpisode(parsed.url,bounded);
}
