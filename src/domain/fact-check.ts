/**
 * Fact check of a citation (João, 2026-10-20). Fidelity (did the person say it?) is the literal
 * transcript match of `citation-library.ts`; this is veracity: is what they said true? Each quote
 * is split into claims of four kinds. Facts and declared figures are searched on the web; opinions
 * and forecasts are not checkable. A claim is validated or disputed only with a source the search
 * returned, so nothing is validated from memory and no link is invented: without a source it is
 * "não validado", which is not "false". The words of the quote never change. Pure and deterministic.
 */

export type ClaimKind = 'fact' | 'declared' | 'opinion' | 'forecast';
export type ClaimVerdict = 'validated' | 'disputed' | 'not_validated';
/** The quote's seal: the worst verdict of its checkable claims. */
export type CitationVerdict = ClaimVerdict | 'not_checkable' | 'pending';

export const CLAIM_KINDS: readonly ClaimKind[] = ['fact', 'declared', 'opinion', 'forecast'];
export const CLAIM_KIND_LABELS: Record<ClaimKind, string> = { fact: 'Fato', declared: 'Dado declarado', opinion: 'Opinião', forecast: 'Previsão' };
export const VERDICT_LABELS: Record<CitationVerdict, string> = { validated: 'Validada', disputed: 'Contestada', not_validated: 'Não validada',
  not_checkable: 'Não checável', pending: 'Pendente' };
export const CLAIM_VERDICT_LABELS: Record<ClaimVerdict, string> = { validated: 'Validado', disputed: 'Contestado', not_validated: 'Não validado' };
/** Display order, best first. */
export const CITATION_VERDICTS: readonly CitationVerdict[] = ['validated', 'not_validated', 'disputed', 'not_checkable', 'pending'];

/** At most this many claims of a quote are searched: one search credit each. */
export const MAX_CHECKED_CLAIMS = 3;

export type FactSource = { url: string; title: string; site: string; excerpt: string; publishedOn?: string };
export type FactClaim = {
  text: string; kind: ClaimKind;
  /** The neutral search the claim was checked with; checkable kinds only. */
  query?: string;
  verdict?: ClaimVerdict; reason?: string; sources: FactSource[];
};
/** An editor's decision on one claim. The latest one per claim wins and keeps its reason. */
export type FactOverride = { claim: number; verdict: ClaimVerdict; reason: string; personId: string; at: string };
export type FactCheck = {
  /** The citation id: the hash of its words and source version, so a check is reused by every article. */
  id: string; checkedAt: string; model: string;
  claims: FactClaim[];
  /** How citable the passage is, 1 (generic) to 5 (specific and quotable), with the model's reason. */
  strength: { score: number; reason: string };
  overrides: FactOverride[];
  /** Earlier checks of the same words, newest first. */
  history: { checkedAt: string; verdict: CitationVerdict }[];
};
export type EffectiveClaim = FactClaim & { overridden?: FactOverride };

export const checkable = (kind: ClaimKind) => kind === 'fact' || kind === 'declared';
const NO_SOURCE = 'Nenhuma fonte encontrada confirma ou contesta a afirmação.';

export function siteOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

/**
 * The guard against invented evidence: a verdict other than "não validado" keeps only sources
 * the search really returned, and needs at least one of them.
 */
export function settleClaim(claim: FactClaim, returned: readonly FactSource[]): FactClaim {
  if (!checkable(claim.kind)) return { text: claim.text, kind: claim.kind, sources: [] };
  const known = new Map(returned.map(source => [source.url, source]));
  const sources = [...new Set(claim.sources.map(source => source.url))].flatMap(url => known.has(url) ? [known.get(url)!] : []);
  if (claim.verdict !== 'validated' && claim.verdict !== 'disputed') return { ...claim, verdict: 'not_validated', sources: [] };
  if (!sources.length) return { ...claim, verdict: 'not_validated', sources: [], reason: NO_SOURCE };
  return { ...claim, sources };
}

export function effectiveClaims(check: FactCheck): EffectiveClaim[] {
  return check.claims.map((claim, index) => {
    const override = check.overrides.filter(entry => entry.claim === index).at(-1);
    return override && checkable(claim.kind) ? { ...claim, verdict: override.verdict, overridden: override } : claim;
  });
}

const SEVERITY: Record<ClaimVerdict, number> = { validated: 0, not_validated: 1, disputed: 2 };

export function citationVerdict(check: FactCheck | undefined): CitationVerdict {
  if (!check) return 'pending';
  const verdicts = effectiveClaims(check).filter(claim => checkable(claim.kind)).map(claim => claim.verdict ?? 'not_validated');
  if (!verdicts.length) return 'not_checkable';
  return verdicts.reduce((worst, verdict) => SEVERITY[verdict] > SEVERITY[worst] ? verdict : worst, 'validated' as ClaimVerdict);
}

export type ClaimTally = { kinds: Record<ClaimKind, number>; checkable: number; validated: number };

export function claimTally(check: FactCheck | undefined): ClaimTally {
  const kinds: Record<ClaimKind, number> = { fact: 0, declared: 0, opinion: 0, forecast: 0 };
  let total = 0, validated = 0;
  for (const claim of check ? effectiveClaims(check) : []) {
    kinds[claim.kind] += 1;
    if (!checkable(claim.kind)) continue;
    total += 1;
    if (claim.verdict === 'validated') validated += 1;
  }
  return { kinds, checkable: total, validated };
}

/** "2 fatos · 1 opinião". */
export function tallyLabel(tally: ClaimTally): string {
  const plural: Record<ClaimKind, string> = { fact: 'fatos', declared: 'dados declarados', opinion: 'opiniões', forecast: 'previsões' };
  return CLAIM_KINDS.filter(kind => tally.kinds[kind] > 0)
    .map(kind => `${tally.kinds[kind]} ${tally.kinds[kind] === 1 ? CLAIM_KIND_LABELS[kind].toLowerCase() : plural[kind]}`).join(' · ');
}

/** The source shown beside the seal: the first one of a validated claim, else of a disputed one. */
export function primarySource(check: FactCheck | undefined): FactSource | undefined {
  const claims = check ? effectiveClaims(check) : [];
  return (claims.find(claim => claim.verdict === 'validated' && claim.sources.length)
    ?? claims.find(claim => claim.verdict === 'disputed' && claim.sources.length))?.sources[0];
}

// ── Score ────────────────────────────────────────────────────────────────────────────────

export const SCORE_WEIGHTS = { veracity: 40, strength: 20, attribution: 20, usage: 20 } as const;
/** A disputed claim keeps a quote out of the best ones, however used it is. */
export const DISPUTED_CEILING = 30;
/** Uses beyond this add nothing. */
export const USAGE_SATURATION = 5;

export type ScoreInput = { check?: FactCheck; authorConfirmed: boolean; sourceNamed: boolean; dated: boolean; linked: boolean; uses: number };
export type CitationScore = { total: number; veracity: number; strength: number; attribution: number; usage: number; capped: boolean };

const CLAIM_POINTS: Record<ClaimVerdict, number> = { validated: 1, not_validated: 0.5, disputed: 0 };

/** 0–100, explained by its four parts. Undefined until the quote is checked. */
export function citationScore(input: ScoreInput): CitationScore | undefined {
  if (!input.check) return undefined;
  const claims = effectiveClaims(input.check).filter(claim => checkable(claim.kind));
  // An opinion is what a quote is for in journalism: a quote without checkable claims is not penalised.
  const share = claims.length ? claims.reduce((sum, claim) => sum + CLAIM_POINTS[claim.verdict ?? 'not_validated'], 0) / claims.length : 1;
  const veracity = Math.round(SCORE_WEIGHTS.veracity * share);
  const level = Math.min(5, Math.max(1, Math.round(input.check.strength.score)));
  const strength = Math.round(SCORE_WEIGHTS.strength * (level - 1) / 4);
  const attribution = (input.authorConfirmed ? 10 : 0) + (input.sourceNamed ? 4 : 0) + (input.dated ? 3 : 0) + (input.linked ? 3 : 0);
  const usage = Math.round(SCORE_WEIGHTS.usage * Math.min(Math.max(0, input.uses), USAGE_SATURATION) / USAGE_SATURATION);
  const sum = veracity + strength + attribution + usage;
  const capped = claims.some(claim => claim.verdict === 'disputed') && sum > DISPUTED_CEILING;
  return { total: capped ? DISPUTED_CEILING : sum, veracity, strength, attribution, usage, capped };
}

/** A new check of the same words keeps the editor's decisions on claims that did not change. */
export function recheck(previous: FactCheck | undefined, next: Omit<FactCheck, 'overrides' | 'history'>): FactCheck {
  const overrides = (previous?.overrides ?? []).flatMap(override => {
    const text = previous!.claims[override.claim]?.text;
    const index = next.claims.findIndex(claim => claim.text === text);
    return index >= 0 ? [{ ...override, claim: index }] : [];
  });
  const history = previous ? [{ checkedAt: previous.checkedAt, verdict: citationVerdict(previous) }, ...previous.history].slice(0, 10) : [];
  return { ...next, overrides, history };
}
