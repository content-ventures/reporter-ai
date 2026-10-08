import { ok, refuse } from '../../../domain/result.ts';
import type { SessionMember, SessionPort } from '../../../ports/session.ts';
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

export function createLocalSession(store: LocalStore): SessionPort {
  return {
    mode: 'simulated',
    workspace: async () => detach(store.state.workspace),
    async current() {
      const member = currentMember(store.state);
      const view = member ? toSessionMember(store.state, member) : undefined;
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
    subscribe(listener) {
      return store.subscribe((notice) => {
        if (notice.scope === 'session' || notice.scope === 'reset') listener(notice);
      });
    },
  };
}
