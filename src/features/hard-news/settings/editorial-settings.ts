import type { EditorialMap, WritingGuide } from '../../../domain/hard-news.ts';
import type { PipelineView } from '../../../domain/pipeline.ts';
import { guideChanges } from './guide-effect.ts';
import { mapChanges } from './map-effect.ts';

export type EditorialVersion = { version: number; at: string; by: string; changes: string[] };

/** Pipeline revisions also include prompt-only changes; show each editorial version once. */
export function editorialHistory(view: PipelineView, kind: 'map' | 'guide'): EditorialVersion[] {
  const revisions = [view.active, ...view.history].sort((a, b) => b.revision - a.revision);
  const seen = new Set<number>();
  const settings: (EditorialMap | WritingGuide)[] = [];
  for (const revision of revisions) {
    const setting = revision.definition.editorial?.[kind];
    if (!setting || setting.version === 0 || seen.has(setting.version)) continue;
    seen.add(setting.version);
    settings.push(setting);
  }
  return settings.map((setting, index) => {
    const previous = settings[index + 1];
    return {
      version: setting.version, at: setting.updatedAt, by: setting.updatedBy,
      changes: previous
        ? kind === 'map' ? mapChanges(previous as EditorialMap, setting as EditorialMap)
          : guideChanges(previous as WritingGuide, setting as WritingGuide)
        : ['Primeira versão disponível neste histórico'],
    };
  });
}

export function validReferenceUrl(value: string): boolean {
  try { return ['https:', 'http:'].includes(new URL(value).protocol); } catch { return false; }
}
