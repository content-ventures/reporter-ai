import type { IsoDateTime, PersonId, WorkspaceId } from './ids.ts';

/** Client boundary. R1 runs with a single workspace; R7 (F7.3) adds the switcher. */
export type Workspace = {
  id: WorkspaceId;
  name: string;
  slug: string;
  createdAt: IsoDateTime;
};

/**
 * Anyone the product talks about: members, interviewees, quoted people. Speakers in a
 * transcript map to a Person so quotes are attributed to someone real (REQ-T.7).
 */
export type Person = {
  id: PersonId;
  name: string;
  /** "Cargo ou função" as the text says it: "fundadora", "diretora de marketing da Casa Forma". */
  title?: string;
  /** "Organização" the person speaks for: "Casa Forma". */
  organization?: string;
  email?: string;
  avatarUrl?: string;
};

/** "Pedro" from "Pedro Alves": notices, refusals and situation lines name people by their first name. */
export function firstName(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}

/** Masculine heads of organisation names ("do Grupo Horizonte", "do Ateliê Sul"); the rest take "da". */
const MASCULINE_HEAD = /^(?:grupo|estúdio|studio|ateliê|atelier|instituto|banco|centro|sindicato|escritório|laboratório|curtume|coletivo|clube|hospital|museu|jornal|portal|site|canal|podcast|programa|projeto|núcleo|conselho|ministério|governo|tribunal|sistema|pátio|polo|parque|shopping|mercado|time|clube)$/i;

/** "da Casa Forma", "do Grupo Horizonte", "do IBGE" (a guess the editor can always rewrite). */
export function ofOrganization(organization: string): string {
  const name = organization.trim();
  const head = name.split(/\s+/)[0] ?? '';
  const masculine = MASCULINE_HEAD.test(head) || /o$/i.test(head) || /^[A-Z0-9]{2,}$/.test(head);
  return `${masculine ? 'do' : 'da'} ${name}`;
}

/**
 * The line that follows a person's name in the text: "diretora de marketing da Casa Forma".
 * The role as written wins when it already names the organisation.
 */
export function personLine(person: Pick<Person, 'title' | 'organization'>): string | undefined {
  const title = person.title?.trim();
  const organization = person.organization?.trim();
  if (!organization) return title || undefined;
  if (!title) return organization;
  return title.toLocaleLowerCase('pt-BR').includes(organization.toLocaleLowerCase('pt-BR')) ? title : `${title} ${ofOrganization(organization)}`;
}

export type Role = 'editor' | 'approver' | 'creative_reviewer' | 'admin';

export const ROLES: readonly Role[] = ['editor', 'approver', 'creative_reviewer', 'admin'];

/** A person's membership in a workspace (REQ-T.1 plug point). */
export type Member = {
  workspaceId: WorkspaceId;
  personId: PersonId;
  roles: Role[];
  /** Simulated-only flag that allows "Agir como" demos; ignored by real adapters. */
  simulated?: boolean;
};

export function hasAnyRole(member: Pick<Member, 'roles'> | undefined, roles: readonly Role[]): boolean {
  if (!member) return false;
  return member.roles.some((role) => roles.includes(role));
}

/** Two-letter initials for avatars ("Marina Lopes" → "ML"). */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  const first = parts[0].charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : parts[0].charAt(1);
  return `${first}${last}`.toUpperCase();
}
