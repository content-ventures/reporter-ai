import type { IsoDateTime, PersonId } from '../../../domain/ids.ts';
import { buildUsageReport } from '../../../domain/platform-usage.ts';
import type { UsageFacts, UsagePeriod } from '../../../domain/platform-usage.ts';
import {
  INVITE_MESSAGES,
  INVITE_TOKEN,
  INVITE_TTL_DAYS,
  PLATFORM_MESSAGES,
  validateInvite,
  validateNewPassword,
  validateRoles,
} from '../../../domain/platform.ts';
import type { InvitePreview, IssuedInvite, PlatformAction, PlatformLogEntry, PlatformPerson, PlatformRefusal, PlatformWorkspace } from '../../../domain/platform.ts';
import { ok, refuse } from '../../../domain/result.ts';
import type { Role } from '../../../domain/workspace.ts';
import type { DirectorySearch,PlatformFilter,InviteDesk, PlatformConsole, PlatformResult } from '../../../ports/platform.ts';

/**
 * The platform console of the demo build: people, invites and the log live in this browser
 * (`localStorage`), usage is the seeded history. It refuses what the server refuses (an e-mail
 * already in, the operator changing their own access, a link that expired) with the same codes.
 */

export const PLATFORM_DEMO_KEY = 'reporter.platform-demo.v1';

type Storage = { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void };

export type DemoPlatformSeed = {
  operatorId: PersonId;
  workspaces: PlatformWorkspace[];
  people: PlatformPerson[];
  log: PlatformLogEntry[];
  facts: UsageFacts;
};

export type DemoPlatformOptions = {
  now: () => IsoDateTime;
  seed: (now: IsoDateTime) => DemoPlatformSeed;
  storage?: Storage | null;
  newToken?: () => string;
};

type Invite = { token: string; personId: PersonId; expiresAt: IsoDateTime; state: 'open' | 'used' | 'revoked' };
type Saved = { people: PlatformPerson[]; log: PlatformLogEntry[]; invites: Invite[]; serial: number };

const DAY_MS = 86_400_000;

function randomToken(): string {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function failed<T>(code: PlatformRefusal): PlatformResult<T> {
  return refuse(code, PLATFORM_MESSAGES[code]);
}

export function createDemoPlatform(options: DemoPlatformOptions): { console: PlatformConsole; invites: InviteDesk } {
  const listeners = new Set<() => void>();
  const newToken = options.newToken ?? randomToken;
  const seed = options.seed(options.now());

  function load(): Saved {
    const raw = options.storage?.getItem(PLATFORM_DEMO_KEY);
    if (raw) {
      try { return JSON.parse(raw) as Saved; } catch { /* a broken snapshot reopens the seed */ }
    }
    // The seeded open link (status `invited`) works too, so the demo can open it.
    const invites = seed.people
      .filter((person) => person.status === 'invited' && person.inviteExpiresAt)
      .map((person) => ({ token: newToken(), personId: person.id, expiresAt: person.inviteExpiresAt as string, state: 'open' as const }));
    return { people: seed.people, log: seed.log, invites, serial: 0 };
  }

  let state = load();

  function save(next: Saved) {
    state = next;
    options.storage?.setItem(PLATFORM_DEMO_KEY, JSON.stringify(next));
    for (const listener of [...listeners]) listener();
  }

  const operator = () => state.people.find((person) => person.id === seed.operatorId);

  function logged(action: PlatformAction, person: PlatformPerson, roles?: Role[], byOperator = true): PlatformLogEntry {
    const actor = operator();
    return {
      id: `log-demo-${state.serial + 1}`,
      at: options.now(),
      action,
      actor: byOperator && actor ? { id: actor.id, name: actor.name, ...(actor.avatarUrl ? { avatarUrl: actor.avatarUrl } : {}) } : null,
      target: { id: person.id, name: person.name, email: person.email },
      ...(roles ? { roles } : {}),
    };
  }

  function write(person: PlatformPerson, entry: PlatformLogEntry, invites = state.invites): void {
    const exists = state.people.some((current) => current.id === person.id);
    save({
      people: exists ? state.people.map((current) => (current.id === person.id ? person : current)) : [person, ...state.people],
      log: [entry, ...state.log],
      invites,
      serial: state.serial + 1,
    });
  }

  function issue(person: PlatformPerson): { invite: IssuedInvite; invites: Invite[] } {
    const token = newToken();
    const expiresAt = new Date(Date.parse(options.now()) + INVITE_TTL_DAYS * DAY_MS).toISOString();
    const invited = { ...person, status: 'invited' as const, inviteExpiresAt: expiresAt };
    const invites = [...state.invites.map((invite) => (invite.personId === person.id && invite.state === 'open' ? { ...invite, state: 'revoked' as const } : invite)),
      { token, personId: person.id, expiresAt, state: 'open' as const }];
    return { invite: { person: invited, token, expiresAt }, invites };
  }

  /** A known person, never the operator themself. */
  function target(personId: PersonId): PlatformResult<PlatformPerson> {
    const person = state.people.find((current) => current.id === personId);
    if (!person) return failed('not_found');
    if (person.id === seed.operatorId) return failed('self');
    return ok(person);
  }

  function withoutInvite(person: PlatformPerson): PlatformPerson {
    const next = { ...person };
    delete next.inviteExpiresAt;
    return next;
  }

  const platform: PlatformConsole = {
    mode: 'demo',
    async operator() {
      const person = operator();
      return person ? ok({ id: person.id, name: person.name, email: person.email, ...(person.avatarUrl ? { avatarUrl: person.avatarUrl } : {}) }) : failed('restricted');
    },
    async directory(query:DirectorySearch={}) {
      const matching=state.people.filter(person=>(!query.personId||person.id===query.personId)&&(!query.workspaceId||person.workspace?.id===query.workspaceId||person.memberships?.some(link=>link.workspace.id===query.workspaceId))
        &&(!query.search||`${person.name} ${person.email}`.toLocaleLowerCase().includes(query.search.toLocaleLowerCase())));
      const counts={all:matching.length,active:0,invited:0,pending:0,suspended:0};for(const person of matching)counts[person.status]++;
      const rows=matching.filter(person=>!query.status||person.status===query.status),offset=query.offset??0;
      return ok({ people:rows.slice(offset,offset+(query.limit??100)),total:rows.length,offset,counts,workspaces:seed.workspaces });
    },
    async usage(period: UsagePeriod,filter:PlatformFilter={}) {
      const include=(fact:{personId:string|null;workspaceId:string})=>(!filter.workspaceId||fact.workspaceId===filter.workspaceId)&&(!filter.personId||fact.personId===filter.personId);
      return ok(buildUsageReport({...seed.facts,generations:seed.facts.generations.filter(include),productions:seed.facts.productions.filter(include),approvals:seed.facts.approvals.filter(include),
        audio:seed.facts.audio.filter(include),activeDays:seed.facts.activeDays.filter(include),...(filter.workspaceId||filter.personId?{storageBytes:0,storageIncomplete:true}:{})},period,options.now()));
    },
    async log(limit: number,filter:PlatformFilter&{offset?:number}={}) {
      const rows=state.log.filter(entry=>(!filter.personId||entry.actor?.id===filter.personId||entry.target?.id===filter.personId)
        &&(!filter.workspaceId||(entry.workspace?.id??state.people.find(person=>person.id===entry.target?.id)?.workspace?.id)===filter.workspaceId));
      return ok({ items:rows.slice(filter.offset??0,(filter.offset??0)+limit),total:rows.length });
    },
    async invite(input) {
      const valid = validateInvite(input);
      if (!valid.ok) return valid;
      const workspace = seed.workspaces.find((entry) => entry.id === valid.value.workspaceId);
      if (!workspace) return failed('invalid_workspace');
      if (state.people.some((person) => person.email === valid.value.email)) return failed('email_taken');
      const person: PlatformPerson = {
        id: `user-demo-${state.serial + 1}`,
        name: valid.value.name,
        email: valid.value.email,
        status: 'invited',
        workspace,
        roles: [valid.value.role],
        operator: false,
        createdAt: options.now(),
      };
      const { invite, invites } = issue(person);
      write(invite.person, logged('invite.created', person, person.roles), invites);
      return ok(invite);
    },
    async renewInvite(personId) {
      const found = target(personId);
      if (!found.ok) return found;
      if (found.value.status !== 'invited') return failed('invalid_state');
      const { invite, invites } = issue(found.value);
      write(invite.person, logged('invite.renewed', found.value), invites);
      return ok(invite);
    },
    async approve(personId, roles) {
      const found = target(personId);
      if (!found.ok) return found;
      if (found.value.status !== 'pending') return failed('invalid_state');
      const valid = validateRoles(roles);
      if (!valid.ok) return valid;
      const person: PlatformPerson = { ...found.value, status: 'active', roles: valid.value, workspace: seed.workspaces[0] };
      write(person, logged('access.approved', person, valid.value));
      return ok(person);
    },
    async setRoles(personId, roles) {
      const found = target(personId);
      if (!found.ok) return found;
      if (found.value.status === 'pending') return failed('invalid_state');
      const valid = validateRoles(roles);
      if (!valid.ok) return valid;
      const person = { ...found.value, roles: valid.value };
      write(person, logged('roles.changed', person, valid.value));
      return ok(person);
    },
    async suspend(personId) {
      const found = target(personId);
      if (!found.ok) return found;
      if (found.value.status === 'suspended' || found.value.status === 'pending') return failed('invalid_state');
      const person: PlatformPerson = { ...withoutInvite(found.value), status: 'suspended' };
      const invites = state.invites.map((invite) => (invite.personId === personId && invite.state === 'open' ? { ...invite, state: 'revoked' as const } : invite));
      write(person, logged('access.suspended', person), invites);
      return ok(person);
    },
    async restore(personId) {
      const found = target(personId);
      if (!found.ok) return found;
      if (found.value.status !== 'suspended') return failed('invalid_state');
      // Someone who never defined a password comes back through a new link.
      if (!found.value.lastSeenAt) {
        const { invite, invites } = issue(found.value);
        write(invite.person, logged('access.restored', found.value), invites);
        return ok({ person: invite.person, invite });
      }
      const person: PlatformPerson = { ...found.value, status: 'active' };
      write(person, logged('access.restored', person));
      return ok({ person });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };

  function openInvite(token: string): Invite | undefined {
    if (!INVITE_TOKEN.test(token)) return undefined;
    return state.invites.find((invite) => invite.token === token);
  }

  const invites: InviteDesk = {
    async preview(token) {
      state = load();
      const invite = openInvite(token);
      const person = invite && state.people.find((current) => current.id === invite.personId);
      if (!invite || !person) return refuse('invalid_link', INVITE_MESSAGES.invalid_link);
      const expired = invite.state === 'open' && Date.parse(invite.expiresAt) <= Date.parse(options.now());
      const preview: InvitePreview = {
        name: person.name,
        email: person.email,
        workspaceName: person.workspace?.name ?? seed.workspaces[0]?.name ?? '',
        roles: person.roles,
        expiresAt: invite.expiresAt,
        state: expired ? 'expired' : invite.state,
        hasAccount: false,
      };
      return ok(preview);
    },
    async accept(token, password, confirmation) {
      state = load();
      const invite = openInvite(token);
      const person = invite && state.people.find((current) => current.id === invite.personId);
      if (!invite || !person) return refuse('invalid_link', INVITE_MESSAGES.invalid_link);
      if (invite.state === 'used') return refuse('used', INVITE_MESSAGES.used);
      if (invite.state === 'revoked') return refuse('invalid_link', INVITE_MESSAGES.invalid_link);
      if (Date.parse(invite.expiresAt) <= Date.parse(options.now())) return refuse('expired', INVITE_MESSAGES.expired);
      const valid = validateNewPassword(password, confirmation);
      if (!valid.ok) return valid;
      const active: PlatformPerson = { ...withoutInvite(person), status: 'active', lastSeenAt: options.now() };
      write(active, logged('invite.accepted', active, undefined, false), state.invites.map((entry) => (entry === invite ? { ...entry, state: 'used' as const } : entry)));
      return ok({ email: person.email, signIn: false });
    },
  };

  return { console: platform, invites };
}
