import type { IsoDateTime, PlatformLogEntry, PlatformPerson, PlatformWorkspace, UsageFacts } from '../domain/index.ts';
import { randomBetween, randomInt, seededRandom } from './prng.ts';
import { ago, DAY_MS, dateOf } from './time.ts';

/**
 * The platform console's demo: one workspace, the fictional team of the workspace fixtures (plus
 * one person still on an open link, one self sign-up waiting and one suspended), and 180 days of
 * usage drawn from a seeded PRNG, so every visit and every test sees the same history.
 */

export const DEMO_WORKSPACE: PlatformWorkspace = { id: 'ws-content-ventures', name: 'Content Ventures', slug: 'content-ventures' };

export const DEMO_OPERATOR_ID = 'user-joao';

type Seed = Omit<PlatformPerson, 'createdAt' | 'lastSeenAt' | 'inviteExpiresAt' | 'workspace'> & {
  created: number;
  seen?: number;
  inviteExpires?: number;
  member: boolean;
};

const SEEDS: readonly Seed[] = [
  { id: DEMO_OPERATOR_ID, name: 'João', email: 'joao@contentventures.com.br', title: 'Editor', status: 'active', roles: ['editor', 'admin'], operator: true, created: 175, seen: 0.01, member: true },
  { id: 'user-pedro', name: 'Pedro', email: 'pedro@contentventures.com.br', title: 'Aprovador', status: 'active', roles: ['approver'], operator: false, created: 170, seen: 0.2, member: true },
  { id: 'user-clara', name: 'Clara Souto', email: 'clara.souto@contentventures.com.br', title: 'Repórter', status: 'active', roles: ['editor'], operator: false, created: 120, seen: 1.1, member: true },
  { id: 'user-rafael', name: 'Rafael Dias', email: 'rafael.dias@contentventures.com.br', title: 'Editor', status: 'active', roles: ['editor'], operator: false, created: 75, seen: 3.4, member: true },
  { id: 'user-juliana', name: 'Juliana Prates', email: 'juliana.prates@contentventures.com.br', title: 'Editora e revisora de criativos', status: 'active', roles: ['editor', 'creative_reviewer'], operator: false, created: 21, seen: 0.6, member: true },
  { id: 'user-tiago', name: 'Tiago Rezende', email: 'tiago.rezende@contentventures.com.br', status: 'invited', roles: ['editor'], operator: false, created: 2, inviteExpires: -5, member: true },
  { id: 'auth:beatriz', name: 'Beatriz Almeida', email: 'beatriz.almeida@gmail.com', status: 'pending', roles: [], operator: false, created: 0.3, member: false },
  { id: 'user-bruno', name: 'Bruno Teles', email: 'bruno.teles@contentventures.com.br', title: 'Repórter', status: 'suspended', roles: ['editor'], operator: false, created: 100, seen: 12, member: true },
];

export function demoPeople(now: IsoDateTime): PlatformPerson[] {
  return SEEDS.map(({ created, seen, inviteExpires, member, ...person }) => ({
    ...person,
    ...(member ? { workspace: DEMO_WORKSPACE } : {}),
    createdAt: ago(now, { days: created }),
    ...(seen === undefined ? {} : { lastSeenAt: ago(now, { days: seen }) }),
    ...(inviteExpires === undefined ? {} : { inviteExpiresAt: ago(now, { days: inviteExpires }) }),
  }));
}

export function demoLog(now: IsoDateTime): PlatformLogEntry[] {
  const joao = { id: DEMO_OPERATOR_ID, name: 'João' };
  const target = (id: string) => {
    const seed = SEEDS.find((entry) => entry.id === id);
    return seed ? { id: seed.id, name: seed.name, email: seed.email } : null;
  };
  return [
    { id: 'log-6', at: ago(now, { days: 2 }), action: 'invite.created', actor: joao, target: target('user-tiago'), roles: ['editor'] },
    { id: 'log-5', at: ago(now, { days: 12 }), action: 'access.suspended', actor: joao, target: target('user-bruno') },
    { id: 'log-4', at: ago(now, { days: 20.5 }), action: 'invite.accepted', actor: null, target: target('user-juliana') },
    { id: 'log-3', at: ago(now, { days: 21 }), action: 'invite.created', actor: joao, target: target('user-juliana'), roles: ['editor', 'creative_reviewer'] },
    { id: 'log-2', at: ago(now, { days: 25 }), action: 'roles.changed', actor: joao, target: target('user-rafael'), roles: ['editor'] },
    { id: 'log-1', at: ago(now, { days: 120 }), action: 'access.approved', actor: joao, target: target('user-clara'), roles: ['editor'] },
  ];
}

/** How busy each active person is (generations per working day, on average). */
const PACE: Readonly<Record<string, number>> = {
  [DEMO_OPERATOR_ID]: 6,
  'user-clara': 5,
  'user-rafael': 3,
  'user-juliana': 2,
  'user-bruno': 2,
};

const MODELS = [
  { model: 'openai/gpt-oss-120b', share: 0.78 },
  { model: 'anthropic/claude-sonnet-4-6', share: 0.14 },
  { model: 'openai/gpt-4.1', share: 0.08 },
];

/** 180 days of usage ending at `now`: weekdays busier, the team growing over the last weeks. */
export function demoUsageFacts(now: IsoDateTime, seed = 2026): UsageFacts {
  const random = seededRandom(seed);
  const facts: UsageFacts = { generations: [], productions: [], approvals: [], audio: [], activeDays: [], storageBytes: 0 };
  const people = demoPeople(now);
  for (let back = 179; back >= 0; back--) {
    const instant = new Date(Date.parse(now) - back * DAY_MS);
    const day = dateOf(instant.toISOString());
    const weekday = instant.getUTCDay() % 6 !== 0;
    for (const person of people) {
      const pace = PACE[person.id];
      const joined = Date.parse(person.createdAt) <= instant.getTime();
      const stillIn = person.status !== 'suspended' || back > 12;
      if (!pace || !joined || !stillIn || random() > (weekday ? 0.85 : 0.2)) continue;
      // The pilot ran slower before the R1 workflow shipped (about six weeks ago).
      const scale = back > 45 ? 0.45 : 1;
      facts.activeDays.push({ day, personId: person.id, workspaceId: DEMO_WORKSPACE.id });
      const productions = randomInt(random, 0, Math.max(1, Math.round((pace / 3) * scale)));
      if (productions) facts.productions.push({ day, personId: person.id, workspaceId: DEMO_WORKSPACE.id, count: productions });
      if (productions && random() < 0.7) facts.audio.push({ day, personId: person.id, workspaceId: DEMO_WORKSPACE.id, model: 'whisper-large-v3', seconds: randomInt(random, 600, 3600) * productions });
      for (const { model, share } of MODELS) {
        const completed = Math.round(randomBetween(random, 0.4, 1.6) * pace * share * scale);
        if (!completed) continue;
        const failed = random() < 0.12 ? 1 : 0;
        const perRun = model.startsWith('anthropic') ? 9000 : 14000;
        facts.generations.push({
          day,
          personId: person.id,
          workspaceId: DEMO_WORKSPACE.id,
          model,
          completed,
          failed,
          inputTokens: Math.round(completed * perRun * randomBetween(random, 0.8, 1.3)),
          outputTokens: Math.round(completed * perRun * 0.22 * randomBetween(random, 0.8, 1.3)),
        });
      }
    }
    const approvals = weekday && back < 170 ? randomInt(random, 0, back > 45 ? 1 : 4) : 0;
    if (approvals) facts.approvals.push({ day, personId: 'user-pedro', workspaceId: DEMO_WORKSPACE.id, count: approvals });
    if (weekday && back < 170 && random() < 0.8) facts.activeDays.push({ day, personId: 'user-pedro', workspaceId: DEMO_WORKSPACE.id });
  }
  facts.storageBytes = facts.audio.reduce((sum, fact) => sum + fact.seconds * 16_000, 0);
  return facts;
}
