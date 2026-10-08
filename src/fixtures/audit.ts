import { DEFAULT_SECTIONS, LENGTH_TARGETS, maskIp, PIECE_LABELS } from '../domain/index.ts';
import type {
  ArticleLength,
  AuditAction,
  AuditChange,
  AuditEvent,
  AuditResult,
  AuditTarget,
  IsoDateTime,
  Piece,
  PersonId,
  Production,
  Source,
  Version,
  Workspace,
} from '../domain/index.ts';
import { FIXTURE_PEOPLE, PEOPLE, WORKSPACE_ID } from './people.ts';
import { seededRandom } from './prng.ts';
import type { Random } from './prng.ts';
import { after, ago } from './time.ts';
import type { Offset } from './time.ts';

/**
 * Seeded audit history (F1.7): about 60 events of the last 30 days that the activity feed does
 * not carry — sign-ins and sign-outs, refused sign-ins, access denials, field updates with
 * before/after and a few failures. Everything is fictional and anchored to the fixture clock;
 * IPs are stored masked. Imported only by src/runtime and tests.
 */

export const AUDIT_SEED = 0x0a0d17;

/** `createFixtures` opens the workspace this many days before its clock (`fixtureWorkspace`). */
export const FIXTURE_WORKSPACE_AGE_DAYS = 90;

/**
 * The fixture clock a workspace was created with. A workspace reopened from this browser keeps
 * its creation date, so the seeded history keeps the same instants across reloads.
 */
export function auditAnchor(workspace: Pick<Workspace, 'createdAt'>): IsoDateTime {
  return after(workspace.createdAt, { days: FIXTURE_WORKSPACE_AGE_DAYS });
}

/** What the seed needs of each production (structural: the runtime passes the store state). */
export type AuditSeedProduction = {
  production: Pick<Production, 'id' | 'title' | 'createdAt' | 'ownerId' | 'brief' | 'sourceIds'>;
  pieces: Pick<Piece, 'id' | 'kind'>[];
  versions: Pick<Version, 'id' | 'pieceId' | 'number'>[];
};

export type AuditSeedInput = {
  now: IsoDateTime;
  productions: readonly AuditSeedProduction[];
  sources: readonly Pick<Source, 'id' | 'title' | 'speakers'>[];
};

type Device = { device: string; ip: string };

const DEVICES: Partial<Record<PersonId, Device>> = {
  [PEOPLE.joao]: { device: 'Chrome · macOS', ip: '189.6.44.120' },
  [PEOPLE.pedro]: { device: 'Safari · iPhone', ip: '177.92.10.33' },
  [PEOPLE.clara]: { device: 'Edge · Windows', ip: '201.17.88.5' },
  [PEOPLE.rafael]: { device: 'Chrome · Windows', ip: '187.45.3.210' },
  [PEOPLE.juliana]: { device: 'Firefox · macOS', ip: '191.33.71.18' },
  [PEOPLE.beatriz]: { device: 'Chrome · Android', ip: '45.170.12.9' },
};

const LOGS_PAGE: AuditTarget = { kind: 'page', id: '/admin/audit', label: 'Logs' };
const DECIDE_REFUSED = 'Só aprovador ou admin decide nesta etapa.';

type Spec = {
  ago: Offset;
  actor: PersonId;
  action: AuditAction;
  result?: AuditResult;
  target?: AuditTarget;
  changes?: AuditChange[];
  reason?: string;
  /** Never before this instant (a record's creation). */
  notBefore?: IsoDateTime;
};

/** Sign-ins (and the matching sign-outs) of the team over the last 30 days. */
const SIGN_INS: readonly [PersonId, number, number][] = [
  [PEOPLE.joao, 0, 1],
  [PEOPLE.joao, 1, 9],
  [PEOPLE.joao, 2, 8],
  [PEOPLE.joao, 3, 9],
  [PEOPLE.joao, 6, 8],
  [PEOPLE.joao, 7, 9],
  [PEOPLE.joao, 8, 8],
  [PEOPLE.joao, 9, 9],
  [PEOPLE.joao, 10, 8],
  [PEOPLE.joao, 13, 9],
  [PEOPLE.joao, 14, 8],
  [PEOPLE.joao, 16, 9],
  [PEOPLE.joao, 20, 8],
  [PEOPLE.joao, 23, 9],
  [PEOPLE.joao, 27, 8],
  [PEOPLE.pedro, 0, 3],
  [PEOPLE.pedro, 2, 5],
  [PEOPLE.pedro, 6, 4],
  [PEOPLE.pedro, 9, 6],
  [PEOPLE.pedro, 13, 5],
  [PEOPLE.pedro, 20, 4],
  [PEOPLE.clara, 1, 7],
  [PEOPLE.clara, 6, 6],
  [PEOPLE.clara, 14, 7],
  [PEOPLE.clara, 21, 6],
  [PEOPLE.rafael, 2, 6],
  [PEOPLE.rafael, 9, 7],
  [PEOPLE.rafael, 16, 5],
  [PEOPLE.juliana, 1, 5],
  [PEOPLE.juliana, 8, 6],
  [PEOPLE.juliana, 15, 5],
];

const SIGN_OUTS: readonly [PersonId, number, number][] = [
  [PEOPLE.joao, 1, 1],
  [PEOPLE.joao, 6, 1],
  [PEOPLE.joao, 9, 1],
  [PEOPLE.pedro, 2, 1],
  [PEOPLE.pedro, 13, 1],
  [PEOPLE.clara, 6, 1],
  [PEOPLE.clara, 14, 1],
  [PEOPLE.juliana, 8, 2],
  [PEOPLE.rafael, 9, 2],
];

function nameOf(personId: PersonId): string {
  return FIXTURE_PEOPLE.find((person) => person.id === personId)?.name ?? 'Pessoa';
}

function lengthLabel(length: ArticleLength): string {
  const target = LENGTH_TARGETS[length];
  return `${target.label} · ${target.words} palavras`;
}

function productionTarget(entry: AuditSeedProduction): AuditTarget {
  return { kind: 'production', id: entry.production.id, label: entry.production.title, productionId: entry.production.id };
}

/** The latest version of a piece kind ("Artigo v3"), else the piece itself. */
function pieceTarget(entry: AuditSeedProduction, kind: Piece['kind']): AuditTarget | undefined {
  const piece = entry.pieces.find((candidate) => candidate.kind === kind);
  if (!piece) return undefined;
  const latest = entry.versions.filter((version) => version.pieceId === piece.id).sort((a, b) => b.number - a.number)[0];
  const base = { productionId: entry.production.id, pieceKind: kind };
  return latest
    ? { kind: 'version', id: latest.id, label: `${PIECE_LABELS[kind]} v${latest.number}`, ...base }
    : { kind: 'piece', id: piece.id, label: PIECE_LABELS[kind], ...base };
}

function productionSpecs(input: AuditSeedInput): Spec[] {
  const byKey = (key: string) => input.productions.find((entry) => entry.production.id === `prod-${key}`);
  const specs: Spec[] = [];

  const aurora = byKey('aurora');
  if (aurora) {
    const brief = aurora.production.brief;
    const changes: AuditChange[] = [];
    if (brief.sections !== DEFAULT_SECTIONS) changes.push({ field: 'Seções', before: String(DEFAULT_SECTIONS), after: String(brief.sections) });
    const previous: ArticleLength = brief.length === 'medium' ? 'long' : 'medium';
    changes.push({ field: 'Extensão', before: lengthLabel(previous), after: lengthLabel(brief.length) });
    specs.push(
      { ago: { days: 4, hours: 7 }, actor: PEOPLE.joao, action: 'production.updated', target: productionTarget(aurora), changes, notBefore: aurora.production.createdAt },
      {
        ago: { days: 4, hours: 6, minutes: 40 },
        actor: PEOPLE.joao,
        action: 'production.updated',
        target: productionTarget(aurora),
        changes: [{ field: 'Título', before: 'Aurora Calçados lança app de reposição', after: aurora.production.title }],
        notBefore: aurora.production.createdAt,
      },
    );
    const article = pieceTarget(aurora, 'article');
    if (article) {
      specs.push({ ago: { days: 1, hours: 6 }, actor: PEOPLE.clara, action: 'review.approved', result: 'denied', target: article, reason: DECIDE_REFUSED, notBefore: aurora.production.createdAt });
    }
  }

  const casaForma = byKey('casa-forma');
  if (casaForma) {
    const article = pieceTarget(casaForma, 'article');
    if (article) {
      specs.push({ ago: { days: 3, hours: 3 }, actor: PEOPLE.rafael, action: 'review.approved', result: 'denied', target: article, reason: DECIDE_REFUSED, notBefore: casaForma.production.createdAt });
    }
    specs.push({
      ago: { days: 2, hours: 5 },
      actor: PEOPLE.juliana,
      action: 'production.updated',
      result: 'failure',
      target: productionTarget(casaForma),
      reason: 'A pauta foi alterada em outra aba. Recarregue para continuar.',
      notBefore: casaForma.production.createdAt,
    });
  }

  const estudioNorte = byKey('estudio-norte');
  if (estudioNorte) {
    const source = input.sources.find((candidate) => estudioNorte.production.sourceIds.includes(candidate.id));
    const mapped = source?.speakers.find((speaker) => speaker.personId && speaker.personId !== PEOPLE.juliana);
    if (source && mapped?.personId) {
      specs.push({
        ago: { days: 5, hours: 4 },
        actor: PEOPLE.clara,
        action: 'source.updated',
        target: { kind: 'source', id: source.id, label: source.title, productionId: estudioNorte.production.id },
        changes: [{ field: `Falante “${mapped.label}”`, before: 'Sem pessoa', after: nameOf(mapped.personId) }],
        notBefore: estudioNorte.production.createdAt,
      });
    }
    const article = pieceTarget(estudioNorte, 'article');
    if (article) {
      specs.push({
        ago: { days: 1, hours: 4 },
        actor: PEOPLE.rafael,
        action: 'article.updated',
        result: 'failure',
        target: article,
        reason: 'O espaço deste navegador acabou. Suas alterações seguem nesta aba; libere espaço e tente de novo.',
        notBefore: estudioNorte.production.createdAt,
      });
    }
  }

  const lume = byKey('lume');
  if (lume) {
    const carousel = pieceTarget(lume, 'carousel');
    if (carousel) {
      specs.push({
        ago: { days: 3, hours: 2 },
        actor: PEOPLE.juliana,
        action: 'carousel.updated',
        target: carousel,
        changes: [{ field: 'Título do slide 1', before: 'Bijuteria artesanal na Europa', after: 'Bijuteria artesanal em 64 lojas europeias' }],
        notBefore: lume.production.createdAt,
      });
    }
    specs.push({
      ago: { hours: 5 },
      actor: PEOPLE.joao,
      action: 'package.exported',
      result: 'failure',
      target: { kind: 'package', id: `pkg-${lume.production.id}`, label: 'Pacote de entrega', productionId: lume.production.id },
      reason: 'Não foi possível montar o arquivo .zip. Tente de novo.',
      notBefore: lume.production.createdAt,
    });
  }

  const horizonte = byKey('horizonte');
  if (horizonte && horizonte.production.ownerId !== PEOPLE.clara) {
    specs.push({
      ago: { days: 2, hours: 7 },
      actor: PEOPLE.joao,
      action: 'production.updated',
      target: productionTarget(horizonte),
      changes: [{ field: 'Responsável', before: nameOf(PEOPLE.clara), after: nameOf(horizonte.production.ownerId) }],
      notBefore: horizonte.production.createdAt,
    });
  }
  return specs;
}

function workspaceSpecs(): Spec[] {
  const signIns: Spec[] = SIGN_INS.map(([actor, days, hours]) => ({ ago: { days, hours }, actor, action: 'auth.signed_in' }));
  const signOuts: Spec[] = SIGN_OUTS.map(([actor, days, hours]) => ({ ago: { days, hours }, actor, action: 'auth.signed_out' }));
  return [
    ...signIns,
    ...signOuts,
    { ago: { days: 6, hours: 4, minutes: 3 }, actor: PEOPLE.pedro, action: 'auth.signed_in', result: 'failure', reason: 'Senha incorreta.' },
    { ago: { days: 16, hours: 5, minutes: 4 }, actor: PEOPLE.rafael, action: 'auth.signed_in', result: 'failure', reason: 'Senha incorreta.' },
    {
      ago: { days: 11, hours: 3 },
      actor: PEOPLE.beatriz,
      action: 'auth.signed_in',
      result: 'denied',
      reason: 'Este e-mail não faz parte do espaço de trabalho.',
    },
    { ago: { days: 1, hours: 6, minutes: 30 }, actor: PEOPLE.clara, action: 'access.denied', result: 'denied', target: LOGS_PAGE, reason: 'Somente administradores consultam os logs.' },
    { ago: { days: 9, hours: 6 }, actor: PEOPLE.rafael, action: 'access.denied', result: 'denied', target: LOGS_PAGE, reason: 'Somente administradores consultam os logs.' },
    { ago: { days: 20, hours: 3 }, actor: PEOPLE.pedro, action: 'access.denied', result: 'denied', target: LOGS_PAGE, reason: 'Somente administradores consultam os logs.' },
    {
      ago: { days: 15, hours: 5 },
      actor: PEOPLE.joao,
      action: 'member.updated',
      target: { kind: 'member', id: PEOPLE.juliana, label: nameOf(PEOPLE.juliana) },
      changes: [{ field: 'Papéis', before: 'Editor', after: 'Editor · Revisor criativo' }],
    },
    {
      ago: { days: 15, hours: 4 },
      actor: PEOPLE.juliana,
      action: 'member.updated',
      result: 'denied',
      target: { kind: 'member', id: PEOPLE.clara, label: nameOf(PEOPLE.clara) },
      reason: 'Somente administradores mudam papéis.',
    },
    {
      ago: { days: 14, hours: 6 },
      actor: PEOPLE.clara,
      action: 'source.created',
      result: 'failure',
      target: { kind: 'source', id: 'upload-bella-passo', label: 'entrevista-bella-passo.docx' },
      reason: 'Envie um arquivo .txt, .md, .srt, .vtt.',
    },
  ];
}

function hex(random: Random, length: number): string {
  let out = '';
  for (let index = 0; index < length; index += 1) out += Math.floor(random() * 16).toString(16);
  return out;
}

/**
 * The seeded trail, oldest first, with stable ids (`aud-s-0001`…). Empty without productions
 * ("Começar vazio"): a new workspace has no history.
 */
export function seededAuditEvents(input: AuditSeedInput, seed = AUDIT_SEED): AuditEvent[] {
  if (input.productions.length === 0) return [];
  const random = seededRandom(seed);
  const specs = [...workspaceSpecs(), ...productionSpecs(input)];
  const drafts = specs.map((spec, index) => {
    const jitter = Math.floor(random() * 50);
    let at = ago(input.now, { ...spec.ago, minutes: (spec.ago.minutes ?? 0) + jitter });
    if (spec.notBefore && Date.parse(at) < Date.parse(spec.notBefore)) at = after(spec.notBefore, { minutes: 20 + jitter });
    return { spec, at, index, requestId: `req-${hex(random, 8)}` };
  });
  // A record created moments ago has no history yet: its seeded updates would land in the future.
  return drafts
    .filter((draft) => Date.parse(draft.at) < Date.parse(input.now))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.index - b.index)
    .map(({ spec, at, requestId }, position): AuditEvent => {
      const device = DEVICES[spec.actor];
      const event: AuditEvent = {
        id: `aud-s-${String(position + 1).padStart(4, '0')}`,
        workspaceId: WORKSPACE_ID,
        at,
        actorId: spec.actor,
        action: spec.action,
        result: spec.result ?? 'success',
        origin: device ? { channel: 'web', device: device.device, ip: maskIp(device.ip) } : { channel: 'web' },
        requestId,
      };
      if (spec.target) event.target = spec.target;
      if (spec.changes) event.changes = spec.changes;
      if (spec.reason) event.reason = spec.reason;
      return event;
    });
}
