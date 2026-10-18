'use client';

import { Drawer, Timeline, formatRelative } from '@content-ventures/design-system/v3';

export type VersionEntry = { version: number; at: string; by: string; changes: string[] };

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * The versions of a desk setting, newest first, each with who saved it and what changed. They sit
 * in a drawer from the header: the page itself is the setting in force.
 */
export function VersionsDrawer({ open, onClose, title, entries, extra }: {
  open: boolean;
  onClose: () => void;
  title: string;
  entries: readonly VersionEntry[];
  /** One more fact per version ("1 artigo escrito com esta versão"). */
  extra?: (entry: VersionEntry) => string | undefined;
}) {
  return (
    <Drawer open={open} onClose={onClose} size="md" title={title} description={plural(entries.length, 'versão', 'versões')}>
      <Timeline
        variant="dots"
        label={title}
        items={entries.map((entry, index) => ({
          id: `v${entry.version}`,
          title: `Versão ${entry.version} · ${entry.by}`,
          description: [entry.changes.join(' · ') || 'Sem mudanças nas regras', extra?.(entry)].filter(Boolean).join(' · '),
          date: formatRelative(new Date(entry.at)),
          dateTime: entry.at,
          state: index === 0 ? 'current' : 'done',
        }))}
      />
    </Drawer>
  );
}
