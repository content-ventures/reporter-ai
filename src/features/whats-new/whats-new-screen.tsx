'use client';

import { useState } from 'react';
import {
  Badge,
  PageHeader,
  PageStack,
  Pagination,
  Panel,
  Section,
  Timeline,
  type TimelineEntry,
} from '@content-ventures/design-system/v3';
import releaseHistory from '@/data/release-history.json';
import { formatDate } from '@/ui/format';

/** Keep a Changelog types → pt-BR. */
const CHANGE_TYPES: Record<string, string> = {
  Added: 'Adicionado',
  Changed: 'Alterado',
  Deprecated: 'Descontinuado',
  Removed: 'Removido',
  Fixed: 'Corrigido',
  Security: 'Segurança',
};

const PAGE_SIZE = 10;

type Change = { type: string; description: string };
type Release = { version: string; roadmapRelease: string; date: string; title: string; summary: string; changes: Change[] };
/** The roadmap release being built (PLAN P14: no version until it ships), validated by `check-versioning`. */
type Upcoming = { roadmapRelease: string; title: string; summary: string; changes: Change[] };
type ReleaseHistory = { currentVersion: string; upcoming?: Upcoming; releases: Release[] };

const history: ReleaseHistory = releaseHistory;

function changeEntries(release: Pick<Release, 'changes'>, key: string): TimelineEntry[] {
  return release.changes.map((change, index) => ({
    id: `${key}-${index}`,
    title: change.description,
    description: CHANGE_TYPES[change.type] ?? change.type,
  }));
}

function releaseEntry(release: Release): TimelineEntry {
  return {
    id: release.version,
    title: `v${release.version} · ${release.title}`,
    description: release.summary,
    date: formatDate(release.date),
    dateTime: release.date,
    state: release.version === history.currentVersion ? 'current' : 'done',
    badge: (
      <Badge tone="gray" size="sm">
        {release.roadmapRelease}
      </Badge>
    ),
    extra: <Timeline label={`Mudanças da versão ${release.version}`} items={changeEntries(release, release.version)} variant="dots" />,
  };
}

/**
 * "Em preparação · R1 · Experiência": what the next roadmap release brings, without a version or
 * a date yet. Its own block (not a numbered step), so the release list keeps its sequence.
 */
function UpcomingSection({ upcoming }: { upcoming: Upcoming }) {
  const entry: TimelineEntry = {
    id: `upcoming-${upcoming.roadmapRelease}`,
    title: `${upcoming.roadmapRelease} · ${upcoming.title}`,
    description: upcoming.summary,
    state: 'upcoming',
    extra: <Timeline label={`Mudanças da ${upcoming.roadmapRelease}`} items={changeEntries(upcoming, upcoming.roadmapRelease)} variant="dots" />,
  };
  return (
    <Section title="Em preparação">
      <Timeline label="Em preparação" items={[entry]} variant="dots" />
    </Section>
  );
}

/**
 * Novidades (`/whats-new`): the product release notes (`src/data/release-history.json`, kept in
 * sync by `pnpm release:prepare`). "Em preparação" announces the roadmap release being built
 * (R1 · Experiência) while the version stays 0.1.0 (D05); then the releases, newest first, each
 * change on its own line with its kind. Paginates once the history grows.
 */
export function WhatsNewScreen() {
  const [page, setPage] = useState(1);
  const releases = history.releases;
  const upcoming = history.upcoming;
  const visible = releases.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  return (
    <PageStack>
      <PageHeader title="Novidades" meta={[`Versão ${history.currentVersion}`]} />
      <Panel>
        {upcoming ? <UpcomingSection upcoming={upcoming} /> : null}
        <Section title="Lançamentos" meta={String(releases.length)}>
          <Timeline label="Lançamentos" items={visible.map(releaseEntry)} variant="steps" />
        </Section>
        {releases.length > PAGE_SIZE ? (
          <Section>
            <Pagination page={page} pageSize={PAGE_SIZE} total={releases.length} onPageChange={setPage} noun="lançamentos" />
          </Section>
        ) : null}
      </Panel>
    </PageStack>
  );
}
