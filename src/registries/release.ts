/**
 * Release gating for every registry. Each entry declares the release that ships it (`since`);
 * screens ask for the entries of the CURRENT release, so R2–R7 plug in by adding data only.
 */

export type ReleaseId = 'R0' | 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6' | 'R7';

export const RELEASES: readonly ReleaseId[] = ['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7'];

/** The release this build shows. Only entries with `since <= CURRENT_RELEASE` are visible. */
export const CURRENT_RELEASE: ReleaseId = 'R1';

/** Roadmap names (planilha do roadmap, aba Releases); the menu says when an item arrives. */
export const RELEASE_NAMES: Record<ReleaseId, string> = {
  R0: 'Fundação do projeto',
  R1: 'Primeiro entregável',
  R2: 'Hard News',
  R3: 'Evergreen',
  R4: 'Cortes de podcast',
  R5: 'Avatar e geração',
  R6: 'Expansão e distribuição',
  R7: 'Plataforma e escala',
};

export type Since = { since: ReleaseId };

export function releaseIndex(release: ReleaseId): number {
  return RELEASES.indexOf(release);
}

/** True when an entry introduced in `since` is part of `release`. */
export function isReleased(since: ReleaseId, release: ReleaseId = CURRENT_RELEASE): boolean {
  return releaseIndex(since) <= releaseIndex(release);
}

/** Entries visible in a release, in their declared order. */
export function availableIn<T extends Since>(entries: readonly T[], release: ReleaseId = CURRENT_RELEASE): T[] {
  return entries.filter((entry) => isReleased(entry.since, release));
}

/** Entries reserved for later releases (plug points that exist only as data today). */
export function reservedAfter<T extends Since>(entries: readonly T[], release: ReleaseId = CURRENT_RELEASE): T[] {
  return entries.filter((entry) => !isReleased(entry.since, release));
}
