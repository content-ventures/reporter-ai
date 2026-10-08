/**
 * Safe link normalisation for article links (toolbar, pasted HTML, AI output). Only http(s),
 * mailto and tel survive; bare domains get `https://`; anything script-like is refused.
 */

export type LinkRefusalReason = 'empty' | 'unsafe' | 'invalid';

export type LinkResult = { ok: true; href: string } | { ok: false; reason: LinkRefusalReason };

export const LINK_REFUSAL_MESSAGES: Record<LinkRefusalReason, string> = {
  empty: 'Informe um endereço.',
  unsafe: 'Este tipo de link não é permitido.',
  invalid: 'Endereço inválido.',
};

const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);
/** Control characters, whitespace and invisible characters used to disguise schemes. */
const INVISIBLE = /[\u0000- \u007f-\u009f​-‍⁠﻿]/g;
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
const EMAIL = /^[^\s@/:]+@[^\s@/:]+\.[^\s@/:]+$/;
const BARE_HOST = /^(?:localhost|[^\s/?#:@]+\.[^\s/?#:@.]{2,})(?::\d+)?(?:[/?#].*)?$/i;

/** `example.com:8080` and `localhost:3000` look like a scheme but are host + port. */
function explicitScheme(compact: string): string | null {
  const match = SCHEME.exec(compact);
  if (!match) return null;
  const name = match[1].toLowerCase();
  const next = compact.charAt(match[0].length);
  if (name.includes('.') || name === 'localhost' || /\d/.test(next)) return null;
  return `${name}:`;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parse(candidate: string): URL | null {
  try {
    return new URL(candidate);
  } catch {
    return null;
  }
}

export function normalizeLink(input: string): LinkResult {
  const trimmed = input.trim();
  const compact = trimmed.replace(INVISIBLE, '');
  if (!compact) return { ok: false, reason: 'empty' };

  const scheme = explicitScheme(compact);
  if (scheme && !ALLOWED_PROTOCOLS.has(scheme)) return { ok: false, reason: 'unsafe' };
  // Inner whitespace is never part of an address; phone numbers may be spaced.
  if (scheme !== 'tel:' && /\s/.test(trimmed)) return { ok: false, reason: 'invalid' };

  let candidate: string;
  if (scheme) candidate = scheme + compact.slice(compact.indexOf(':') + 1);
  else if (compact.startsWith('//')) candidate = `https:${compact}`;
  else if (EMAIL.test(compact)) candidate = `mailto:${compact}`;
  else if (BARE_HOST.test(compact)) candidate = `https://${compact}`;
  else return { ok: false, reason: 'invalid' };

  const url = parse(candidate);
  if (!url) return { ok: false, reason: 'invalid' };
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return { ok: false, reason: 'unsafe' };

  if (url.protocol === 'http:' || url.protocol === 'https:') {
    if (url.username || url.password) return { ok: false, reason: 'unsafe' };
    if (!url.hostname.includes('.') && url.hostname !== 'localhost') return { ok: false, reason: 'invalid' };
  }
  if (url.protocol === 'mailto:' && !EMAIL.test(safeDecode(url.pathname))) {
    return { ok: false, reason: 'invalid' };
  }
  if (url.protocol === 'tel:' && !/^\+?[\d().-]{3,}$/.test(url.pathname)) return { ok: false, reason: 'invalid' };
  return { ok: true, href: url.href };
}

export function isSafeLink(input: string): boolean {
  return normalizeLink(input).ok;
}
