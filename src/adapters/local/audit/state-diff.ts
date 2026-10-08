import type { AuditAction, AuditChange, AuditTarget } from '../../../domain/audit.ts';
import type { PersonId } from '../../../domain/ids.ts';
import { LENGTH_TARGETS } from '../../../domain/production.ts';
import type { Brief, Production } from '../../../domain/production.ts';
import type { Source } from '../../../domain/source.ts';
import type { Member, Role } from '../../../domain/workspace.ts';
import type { StoreState } from '../store/state.ts';

/**
 * Field updates the activity feed does not log (rename, brief, owner, speaker mapping, roles),
 * found by comparing two store states. Each changed record yields one entry with its fields
 * before and after, attributed to the acting member.
 */

export type UpdateDraft = { action: AuditAction; target: AuditTarget; changes: AuditChange[] };

const ROLE_NAMES: Record<Role, string> = { editor: 'Editor', approver: 'Aprovador', creative_reviewer: 'Revisor criativo', admin: 'Admin' };

function personName(state: Pick<StoreState, 'people'>, personId: PersonId | undefined): string {
  if (!personId) return 'Sem pessoa';
  return state.people.find((person) => person.id === personId)?.name ?? 'Pessoa removida';
}

function lengthLabel(length: Brief['length']): string {
  const target = LENGTH_TARGETS[length];
  return target ? `${target.label} · ${target.words} palavras` : length;
}

function change(changes: AuditChange[], field: string, before: string, after: string): void {
  if (before !== after) changes.push({ field, before, after });
}

function productionChanges(state: StoreState, before: Production, after: Production): AuditChange[] {
  const changes: AuditChange[] = [];
  change(changes, 'Título', before.title, after.title);
  change(changes, 'Orientação editorial', before.brief.angle?.trim() || 'Sem orientação', after.brief.angle?.trim() || 'Sem orientação');
  change(changes, 'Seções', String(before.brief.sections), String(after.brief.sections));
  change(changes, 'Extensão', lengthLabel(before.brief.length), lengthLabel(after.brief.length));
  change(changes, 'Responsável', personName(state, before.ownerId), personName(state, after.ownerId));
  return changes;
}

/** Speakers present in both versions whose person changed (labels added by a revision are not edits). */
function speakerChanges(state: StoreState, before: Source, after: Source): AuditChange[] {
  const changes: AuditChange[] = [];
  for (const speaker of after.speakers) {
    const previous = before.speakers.find((entry) => entry.label === speaker.label);
    if (!previous) continue;
    change(changes, `Falante “${speaker.label}”`, personName(state, previous.personId), personName(state, speaker.personId));
  }
  return changes;
}

function rolesLabel(member: Pick<Member, 'roles'>): string {
  return member.roles.map((role) => ROLE_NAMES[role] ?? role).join(' · ') || 'Sem papel';
}

export function updatesBetween(before: StoreState, after: StoreState): UpdateDraft[] {
  const drafts: UpdateDraft[] = [];

  if (before.productions !== after.productions) {
    for (const entry of after.productions) {
      const previous = before.productions.find((candidate) => candidate.production.id === entry.production.id);
      if (!previous || previous.production === entry.production) continue;
      const changes = productionChanges(after, previous.production, entry.production);
      if (changes.length === 0) continue;
      const { production } = entry;
      drafts.push({
        action: 'production.updated',
        target: { kind: 'production', id: production.id, label: production.title, productionId: production.id },
        changes,
      });
    }
  }

  if (before.sources !== after.sources) {
    for (const source of after.sources) {
      const previous = before.sources.find((candidate) => candidate.id === source.id);
      if (!previous || previous === source) continue;
      const changes = speakerChanges(after, previous, source);
      if (changes.length === 0) continue;
      const target: AuditTarget = { kind: 'source', id: source.id, label: source.title };
      const owner = after.productions.find((entry) => entry.production.sourceIds.includes(source.id));
      if (owner) target.productionId = owner.production.id;
      drafts.push({ action: 'source.updated', target, changes });
    }
  }

  if (before.members !== after.members) {
    for (const member of after.members) {
      const previous = before.members.find((candidate) => candidate.personId === member.personId);
      if (!previous) continue;
      const changes: AuditChange[] = [];
      change(changes, 'Papéis', rolesLabel(previous), rolesLabel(member));
      if (changes.length === 0) continue;
      drafts.push({ action: 'member.updated', target: { kind: 'member', id: member.personId, label: personName(after, member.personId) }, changes });
    }
  }

  return drafts;
}
