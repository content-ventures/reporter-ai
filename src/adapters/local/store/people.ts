import type { ActorId, PersonId } from '../../../domain/ids.ts';
import { SYSTEM_ACTOR } from '../../../domain/ids.ts';
import type { ProductionRecord } from '../../../domain/record.ts';
import { toSourceSummary } from '../../../domain/views.ts';
import { initialsOf, personLine } from '../../../domain/workspace.ts';
import type { Member, Person } from '../../../domain/workspace.ts';
import type { PersonSummary } from '../../../ports/common.ts';
import type { Participant } from '../../../ports/production-queries.ts';
import type { SessionMember } from '../../../ports/session.ts';
import type { StoreState } from './state.ts';

export function toPersonSummary(person: Person): PersonSummary {
  const summary: PersonSummary = { id: person.id, name: person.name, initials: initialsOf(person.name) };
  if (person.title) summary.title = person.title;
  if (person.organization) summary.organization = person.organization;
  const line = personLine(person);
  if (line) summary.line = line;
  if (person.avatarUrl) summary.avatarUrl = person.avatarUrl;
  return summary;
}

/** `null` for the system actor; a neutral placeholder for an id nobody knows anymore. */
export function personOf(state: Pick<StoreState, 'people'>, id: ActorId | undefined): PersonSummary | null {
  if (!id || id === SYSTEM_ACTOR) return null;
  const person = state.people.find((candidate) => candidate.id === id);
  return person ? toPersonSummary(person) : { id, name: 'Pessoa removida', initials: '?' };
}

export function currentMember(state: StoreState): Member | undefined {
  return state.members.find((member) => member.personId === state.sessionPersonId);
}

export function toSessionMember(state: StoreState, member: Member): SessionMember | undefined {
  const person = state.people.find((candidate) => candidate.id === member.personId);
  if (!person) return undefined;
  return { ...toPersonSummary(person), workspaceId: member.workspaceId, roles: [...member.roles] };
}

/** Speakers of a production's material, merged by label, with the mapped person. */
export function participantsOf(state: Pick<StoreState, 'people'>, record: Pick<ProductionRecord, 'sources'>): Participant[] {
  const byLabel = new Map<string, Participant>();
  for (const source of record.sources) {
    for (const speaker of toSourceSummary(source).speakers) {
      const existing = byLabel.get(speaker.label);
      if (existing) {
        existing.segments += speaker.segments;
        existing.words += speaker.words;
        continue;
      }
      const participant: Participant = { label: speaker.label, segments: speaker.segments, words: speaker.words };
      const person = speaker.personId ? personOf(state, speaker.personId) : null;
      if (person) participant.person = person;
      else if (source.speakers.some((entry) => entry.label === speaker.label && entry.unattributed)) participant.unattributed = true;
      byLabel.set(speaker.label, participant);
    }
  }
  return [...byLabel.values()];
}

export function isKnownPerson(state: Pick<StoreState, 'people'>, personId: PersonId): boolean {
  return state.people.some((person) => person.id === personId);
}
