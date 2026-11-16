import { DomUtils, parseDocument } from 'htmlparser2';
import 'server-only';
import { publicPage } from './public-page';
import { FlowError } from './errors';
import { MAX_TEXT_BYTES } from '../domain/reporter.ts';

type HtmlNode = ReturnType<typeof parseDocument>['children'][number];
const SKIPPED_TAGS = new Set(['script', 'style', 'nav', 'footer', 'header', 'noscript', 'form', 'svg', 'iframe']);
const BLOCK_TAGS = new Set(['p', 'div', 'section', 'article', 'main', 'h1', 'h2', 'h3', 'h4', 'li', 'blockquote']);
function readableNode(node: HtmlNode): string {
  if (node.type === 'text') return node.data;
  if ('name' in node && SKIPPED_TAGS.has(node.name.toLowerCase())) return '';
  if ('name' in node && node.name === 'br') return '\n';
  const value = 'children' in node ? node.children.map(readableNode).join('') : '';
  return value + ('name' in node && BLOCK_TAGS.has(node.name.toLowerCase()) ? '\n' : '');
}
export function websiteText(html: string): { title: string; text: string } {
  const document = parseDocument(html);
  const titleNode = DomUtils.getElementsByTagName('title', document.children, true, 1)[0];
  const title = (titleNode ? DomUtils.textContent(titleNode) : 'Fonte da web').trim().slice(0, 200);
  const article = DomUtils.getElementsByTagName('article', document.children, true, 1)[0]
    ?? DomUtils.getElementsByTagName('main', document.children, true, 1)[0]
    ?? DomUtils.getElementsByTagName('body', document.children, true, 1)[0];
  const text = (article ? readableNode(article) : document.children.filter(node => node !== titleNode).map(readableNode).join(''))
    .replace(/[\t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { title, text };
}
export async function readWebsite(url: string, requestedSignal: AbortSignal) {
  const signal = AbortSignal.any([requestedSignal, AbortSignal.timeout(20000)]);
  const response = await publicPage(url, signal);
  const type = response.type;
  if (!/text\/(html|plain)|application\/xhtml\+xml/i.test(type)) { throw new FlowError('SOURCE_LINK_INVALID', 422); }
  const raw = response.text, extracted = type.includes('plain') ? { title: new URL(url).hostname, text: raw.trim() } : websiteText(raw);
  if (extracted.text.length < 100) throw new FlowError('SOURCE_LINK_INVALID', 422);
  const text = `Fonte original: ${response.url || url}\n${extracted.title}\n\n${extracted.text}`;
  if (Buffer.byteLength(text) > MAX_TEXT_BYTES) throw new FlowError('TEXT_TOO_LARGE', 422);
  return { kind: 'ready' as const, provider: 'web' as const, sourceUrl: response.url || url, title: extracted.title, fileName: extracted.title.replace(/[\x00-\x1f/\\]/g, ' ').slice(0, 160) + '.txt', text, bytes: Buffer.byteLength(text) };
}
/** Explicitly requested research; actual pages are imported as evidence with their URLs. */
export async function researchWeb(query: string, signal: AbortSignal) {
  const response = await publicPage('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query), signal);
  const html = response.text;
  const urls = [...new Set([...html.matchAll(/href="[^"\s]*[?&]uddg=([^"&\s]+)/g)].map(match => {
    try { return decodeURIComponent(match[1]); } catch { return ''; }
  }).filter(url => url.startsWith('https://')))].slice(0, 3);
  const imported = await Promise.allSettled(urls.map(url => readWebsite(url, signal)));
  const sources = imported.flatMap(result => result.status === 'fulfilled' ? [{ url: result.value.sourceUrl, text: result.value.text }] : []);
  if (!sources.length) throw new FlowError('SOURCE_LINK_INVALID', 422);
  return { sources };
}
