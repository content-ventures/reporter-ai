import { isNewsAddress } from './news-intake.ts';

/** Public site identity, using the same favicon service as the integration catalogue. */
export function newsLogoUrl(value: string): string | undefined {
  if (!isNewsAddress(value)) return undefined;
  const host = new URL(value).hostname.toLowerCase().replace(/^www\./, '');
  // Send only the publisher's host; article paths and query parameters stay private.
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
}
