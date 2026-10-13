/** Text normalisation shared by parsing, hashing, quote checks and diffs. */

const SPACE_LIKE = /[   -   　\t\f\v]/g;
const ZERO_WIDTH = /[​-‍⁠﻿]/g;

/** Unifies line endings to `\n` and drops a leading BOM. */
export function normalizeNewlines(text: string): string {
  return text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

/** Replaces exotic spaces with a plain space, removes zero-width characters, collapses runs. */
export function normalizeSpaces(text: string): string {
  return text.replace(ZERO_WIDTH, '').replace(SPACE_LIKE, ' ').replace(/ {2,}/g, ' ');
}

/** Single-line clean text: NFC, unified spaces, newlines → spaces, trimmed. */
export function cleanText(text: string): string {
  return normalizeSpaces(normalizeNewlines(text).normalize('NFC').replace(/\n+/g, ' ')).trim();
}

const QUOTE_LIKE = /[“”„‟«»"″]/g;
const APOSTROPHE_LIKE = /[‘’‚‛'′`´]/g;
const DASH_LIKE = /[‐‑‒–—―−]/g;

/**
 * Folds text for deterministic matching (quote check): NFC, lower case, typographic quotes,
 * apostrophes and dashes unified, punctuation removed, whitespace collapsed. Diacritics are
 * kept on purpose: "é" vs "e" can change meaning, so it counts as a different quote.
 */
export function foldForMatch(text: string): string {
  return cleanText(text)
    .toLocaleLowerCase('pt-BR')
    .replace(QUOTE_LIKE, ' ')
    .replace(APOSTROPHE_LIKE, "'")
    .replace(DASH_LIKE, '-')
    .replace(/[^\p{L}\p{N}'\s-]/gu, ' ')
    .replace(/(^|\s)['-]+|['-]+(?=\s|$)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * File-name slug: lower case, accents removed, words joined by hyphens, cut at a word boundary
 * ("Estúdio Norte amplia a produção" → "estudio-norte-amplia-a-producao").
 */
export function slugify(text: string, maxLength = 48): string {
  const slug = cleanText(text)
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug.length <= maxLength) return slug;
  const cut = slug.slice(0, maxLength + 1);
  const boundary = cut.lastIndexOf('-');
  return (boundary > 0 ? cut.slice(0, boundary) : slug.slice(0, maxLength)).replace(/-+$/g, '');
}
