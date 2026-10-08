import type { IsoDateTime, Member, Person, PersonId, Workspace } from '../domain/index.ts';

/**
 * Workspace, team and interviewees. Everything here is fictional: the companies and people
 * come from the Design System's fictional roster (README §11) plus a few invented names.
 * João and Pedro are the pilot roles (editor/admin and approver), never real quotes.
 */

export const WORKSPACE_ID = 'ws-content-ventures';

export const PEOPLE = {
  joao: 'person-joao',
  pedro: 'person-pedro',
  clara: 'person-clara-souto',
  rafael: 'person-rafael-dias',
  juliana: 'person-juliana-prates',
  marina: 'person-marina-lopes',
  tiago: 'person-tiago-rezende',
  helena: 'person-helena-brandao',
  sergio: 'person-sergio-lang',
  lia: 'person-lia-moraes',
  renata: 'person-renata-vidal',
  caio: 'person-caio-nogueira',
  gustavo: 'person-gustavo-hoff',
  fernanda: 'person-fernanda-kuhn',
  otavio: 'person-otavio-kern',
  beatriz: 'person-beatriz-almeida',
} as const satisfies Record<string, PersonId>;

/** The session user of the simulated runtime ("Agir como" can switch to Pedro later). */
export const DEFAULT_VIEWER_ID: PersonId = PEOPLE.joao;

export const FIXTURE_PEOPLE: readonly Person[] = [
  { id: PEOPLE.joao, name: 'João', title: 'Editor' },
  { id: PEOPLE.pedro, name: 'Pedro', title: 'Aprovador' },
  { id: PEOPLE.clara, name: 'Clara Souto', title: 'Repórter' },
  { id: PEOPLE.rafael, name: 'Rafael Dias', title: 'Editor' },
  { id: PEOPLE.juliana, name: 'Juliana Prates', title: 'Editora e revisora de criativos' },
  { id: PEOPLE.marina, name: 'Marina Lopes', title: 'fundadora do Ateliê Sul', organization: 'Ateliê Sul' },
  { id: PEOPLE.tiago, name: 'Tiago Rezende', title: 'consultor de comércio exterior' },
  { id: PEOPLE.helena, name: 'Helena Brandão', title: 'sócia do Estúdio Norte', organization: 'Estúdio Norte' },
  { id: PEOPLE.sergio, name: 'Sérgio Lang', title: 'diretor comercial da Aurora Calçados', organization: 'Aurora Calçados' },
  { id: PEOPLE.lia, name: 'Lia Moraes', title: 'diretora de marketing da Casa Forma', organization: 'Casa Forma' },
  { id: PEOPLE.renata, name: 'Renata Vidal', title: 'fundadora da Lume Acessórios', organization: 'Lume Acessórios' },
  { id: PEOPLE.caio, name: 'Caio Nogueira', title: 'gerente de sustentabilidade da Pátio Couro', organization: 'Pátio Couro' },
  { id: PEOPLE.gustavo, name: 'Gustavo Hoff', title: 'diretor de produto da Bella Passo', organization: 'Bella Passo' },
  { id: PEOPLE.fernanda, name: 'Fernanda Kuhn', title: 'gerente de operações do Grupo Horizonte', organization: 'Grupo Horizonte' },
  { id: PEOPLE.otavio, name: 'Otávio Kern', title: 'diretor técnico do Couro Nobre', organization: 'Couro Nobre' },
  { id: PEOPLE.beatriz, name: 'Beatriz Almeida', title: 'designer de calçados' },
];

export const FIXTURE_MEMBERS: readonly Member[] = [
  { workspaceId: WORKSPACE_ID, personId: PEOPLE.joao, roles: ['editor', 'admin'], simulated: true },
  { workspaceId: WORKSPACE_ID, personId: PEOPLE.pedro, roles: ['approver'], simulated: true },
  { workspaceId: WORKSPACE_ID, personId: PEOPLE.clara, roles: ['editor'], simulated: true },
  { workspaceId: WORKSPACE_ID, personId: PEOPLE.rafael, roles: ['editor'], simulated: true },
  { workspaceId: WORKSPACE_ID, personId: PEOPLE.juliana, roles: ['editor', 'creative_reviewer'], simulated: true },
];

export function fixtureWorkspace(createdAt: IsoDateTime): Workspace {
  return { id: WORKSPACE_ID, name: 'Content Ventures', slug: 'content-ventures', createdAt };
}

export function personName(id: PersonId): string {
  return FIXTURE_PEOPLE.find((person) => person.id === id)?.name ?? id;
}
