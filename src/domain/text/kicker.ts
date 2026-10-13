/**
 * The carousel cover's call ("Chamada"): "editoria · marca", e.g. "Exportação · Lume Acessórios".
 * The editoria is the newsroom section the article's own words point to; the brand is the
 * organisation of the people who speak in the interview. Both are picked, never written: no
 * section scores, no organisation linked → the part is left out. Pure (no React, no DS).
 */

type Editoria = { label: string; terms: readonly string[] };

/** Sections and the word starts that point to them (lower case, pt-BR). Order breaks ties. */
const EDITORIAS: readonly Editoria[] = [
  { label: 'Tendências', terms: ['tendênc', 'verão', 'inverno', 'temporada', 'estação', 'cartela', 'paleta'] },
  { label: 'Exportação', terms: ['export', 'exterior', 'internaciona', 'europ', 'importador', 'mercado externo'] },
  { label: 'Sustentabilidade', terms: ['sustentab', 'reaproveit', 'resíduo', 'aparas', 'recicl', 'descarte', 'carbono', 'circular'] },
  { label: 'Produto', terms: ['produto', 'coleção', 'coleções', 'lançamento', 'protótipo', 'linha de'] },
  { label: 'Varejo', terms: ['varejo', 'loja', 'vitrine', 'consumidor', 'e-commerce'] },
  { label: 'Marketing', terms: ['marketing', 'campanha', 'comunicação', 'redes sociais', 'influenciador'] },
  // Not "fábrica": in this trade every interview speaks of one, so the word names no subject.
  { label: 'Operações', terms: ['logística', 'operaç', 'estoque', 'fornecedor', 'insumo', 'linha de produção'] },
  { label: 'Tecnologia', terms: ['tecnologia', 'digital', 'software', 'automaç', 'aplicativo', 'inteligência artificial'] },
  { label: 'Gestão', terms: ['gestão', 'liderança', 'sucessão', 'governança', 'contrataç'] },
  { label: 'Negócios', terms: ['cooperativa', 'faturamento', 'negócio', 'empreend', 'sócia', 'sócio'] },
];

/** A section needs at least this many hits; one stray word is not a subject. */
const MIN_SCORE = 3;
/** Words of the title count this many times (the title says what the piece is about). */
const TITLE_WEIGHT = 3;

const LETTER = /[\p{L}\p{N}]/u;

/** Occurrences of `term` at the start of a word in `text` (both lower case). */
function hits(text: string, term: string): number {
  let count = 0;
  for (let at = text.indexOf(term); at !== -1; at = text.indexOf(term, at + term.length)) {
    if (at === 0 || !LETTER.test(text.charAt(at - 1))) count += 1;
  }
  return count;
}

/** The editoria the text is about ("Exportação"), or undefined when no section stands out. */
export function articleTopic(input: { title?: string; text: string }): string | undefined {
  const title = (input.title ?? '').toLocaleLowerCase('pt-BR');
  const text = input.text.toLocaleLowerCase('pt-BR');
  let best: { label: string; score: number } | undefined;
  for (const editoria of EDITORIAS) {
    const score = editoria.terms.reduce((sum, term) => sum + hits(text, term) + TITLE_WEIGHT * hits(title, term), 0);
    if (score >= MIN_SCORE && (!best || score > best.score)) best = { label: editoria.label, score };
  }
  return best?.label;
}

/** The organisation that speaks the most (weight = segments or words); ties keep the first. */
export function mainOrganization(candidates: readonly { organization?: string; weight: number }[]): string | undefined {
  const totals = new Map<string, number>();
  for (const candidate of candidates) {
    const name = candidate.organization?.trim();
    if (name) totals.set(name, (totals.get(name) ?? 0) + Math.max(0, candidate.weight));
  }
  let best: { name: string; weight: number } | undefined;
  for (const [name, weight] of totals) {
    if (!best || weight > best.weight) best = { name, weight };
  }
  return best?.name;
}

/**
 * "Exportação · Lume Acessórios" within the slot budget: both parts when they fit, else the brand,
 * else the editoria, else `fallback` (the source origin, "Entrevista").
 */
export function coverKicker(parts: { topic?: string; brand?: string; fallback?: string }, maxChars: number): string | undefined {
  const topic = parts.topic?.trim();
  const brand = parts.brand?.trim();
  const fits = (text: string | undefined) => (text && text.length <= maxChars ? text : undefined);
  return fits(topic && brand ? `${topic} · ${brand}` : undefined) ?? fits(brand) ?? fits(topic) ?? fits(parts.fallback?.trim());
}
