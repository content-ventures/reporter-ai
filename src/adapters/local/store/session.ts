import type { ProfileRefusal } from '../../../domain/profile.ts';
import { validateProfilePatch } from '../../../domain/profile.ts';
import { ok, refuse } from '../../../domain/result.ts';
import type { Result } from '../../../domain/result.ts';
import type { Person } from '../../../domain/workspace.ts';
import type { SessionMember, SessionPort } from '../../../ports/session.ts';
import { avatarImage } from '../assets/avatar-image.ts';
import { dataUrl } from '../render/encoding.ts';
import type { LocalStore, Tx } from './local-store.ts';
import { currentMember, toSessionMember } from './people.ts';
import { detach } from './queries.ts';
import type { StoreState } from './state.ts';

/** Fixture members; "Agir como" switches the acting member (simulated mode only). */

function members(state: StoreState): SessionMember[] {
  return state.members
    .filter((member) => member.workspaceId === state.workspace.id)
    .map((member) => toSessionMember(state, member))
    .filter((member): member is SessionMember => member !== undefined);
}

/** The acting member, with the sign-in e-mail only they see. */
function current(state: StoreState): SessionMember | undefined {
  const member = currentMember(state);
  const view = member ? toSessionMember(state, member) : undefined;
  const email = view && state.people.find((person) => person.id === view.id)?.email;
  return view && email ? { ...view, email } : view;
}

export function createLocalSession(store: LocalStore): SessionPort {
  /** Rewrites only the acting member's person; everyone else stays as they are. */
  const editSelf = (edit: (person: Person) => Person): Result<SessionMember, ProfileRefusal> => {
    const result = store.transact((state): Tx<SessionMember, ProfileRefusal> => {
      const self = current(state);
      if (!self) return refuse('unavailable', 'Nenhuma conta conectada.');
      const next = { ...state, people: state.people.map((person) => (person.id === self.id ? edit(person) : person)) };
      return ok({ state: next, value: current(next)!, scope: 'session' });
    });
    return result.ok ? ok(detach(result.value)) : result;
  };
  return {
    mode: 'simulated',
    workspace: async () => detach(store.state.workspace),
    async current() {
      const view = current(store.state);
      return view ? detach(view) : undefined;
    },
    members: async () => detach(members(store.state)),
    async actAs(personId) {
      const result = store.transact((state): Tx<SessionMember, 'unknown_member'> => {
        const member = members(state).find((entry) => entry.id === personId);
        if (!member) return refuse('unknown_member', 'Esta pessoa não faz parte do espaço de trabalho.');
        return ok({ state: { ...state, sessionPersonId: personId }, value: member, scope: 'session' });
      });
      return result.ok ? ok(detach(result.value)) : result;
    },
    async updateProfile(patch) {
      const valid = validateProfilePatch(patch);
      if (!valid.ok) return valid;
      const { name, title } = valid.value;
      return editSelf((person) => {
        const next: Person = { ...person, ...(name === undefined ? {} : { name }) };
        if (title === null) delete next.title;
        else if (title !== undefined) next.title = title;
        return next;
      });
    },
    async setAvatar(input) {
      if (!input) {
        return editSelf((person) => {
          const next = { ...person };
          delete next.avatarUrl;
          return next;
        });
      }
      const image = await avatarImage(input);
      if (!image.ok) return image;
      // A data URL survives reloads in the saved snapshot; the squared JPEG is ~50 KB.
      const avatarUrl = dataUrl(image.value.type || 'image/jpeg', new Uint8Array(await image.value.arrayBuffer()));
      return editSelf((person) => ({ ...person, avatarUrl }));
    },
    subscribe(listener) {
      return store.subscribe((notice) => {
        if (notice.scope === 'session' || notice.scope === 'reset') listener(notice);
      });
    },
  };
}
