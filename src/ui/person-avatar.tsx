'use client';

import { useMemo } from 'react';
import { Avatar, type AvatarPresence, type AvatarSize } from '@content-ventures/design-system/v3';
import type { PersonId } from '@/domain';
import type { PersonSummary } from '@/ports';
import { usePeople } from '@/state';

/**
 * People are drawn as the DS Avatar orb (never initials, §1.6). Pass the `PersonSummary` the read
 * model already carries; with only an id, the workspace people list resolves the name.
 */

/** A person of the workspace (members and interviewees) by id; `undefined` while loading. */
export function usePerson(personId: PersonId | string | null | undefined): PersonSummary | undefined {
  const people = usePeople();
  return useMemo(
    () => (personId && people.data ? people.data.find((person) => person.id === personId) : undefined),
    [people.data, personId],
  );
}

export type PersonAvatarProps = {
  person?: Pick<PersonSummary, 'name' | 'avatarUrl'> | null;
  /** Resolved through the people list when `person` is absent. */
  personId?: PersonId | string | null;
  /** Fallback name (speaker label, "Sistema"). */
  name?: string;
  size?: AvatarSize;
  presence?: AvatarPresence;
  /** Next to a visible name: hide the orb from screen readers. */
  decorative?: boolean;
};

export function PersonAvatar({ person, personId, name, size = 'sm', presence, decorative = false }: PersonAvatarProps) {
  const resolved = usePerson(person ? null : personId);
  const who = person ?? resolved;
  return (
    <Avatar
      name={who?.name ?? name ?? 'Pessoa'}
      src={who?.avatarUrl}
      size={size}
      presence={presence}
      decorative={decorative}
    />
  );
}
