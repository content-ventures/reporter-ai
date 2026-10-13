import { ARTICLE_GATE, CAROUSEL_GATE } from '../domain/index.ts';
import type { DecisionSubject, GateDefinition, GateId } from '../domain/index.ts';
import { availableIn, CURRENT_RELEASE } from './release.ts';
import type { ReleaseId } from './release.ts';

/**
 * Human gates (REQ-T.6). Every gate records the same `Decision` on an exact subject; later
 * releases add gates over sources (news triage), briefs (pautas) and assets (avatar, voice).
 */

export type GateEntry = GateDefinition & {
  since: ReleaseId;
  /** What the decision is about. */
  subjectKind: DecisionSubject['kind'];
};

export const GATES: readonly GateEntry[] = [
  { ...ARTICLE_GATE, since: 'R1', subjectKind: 'version' },
  { ...CAROUSEL_GATE, since: 'R1', subjectKind: 'version' },
  {
    id: 'news.triage',
    label: 'Triagem de notícias',
    roles: ['editor', 'admin'],
    decisions: ['selected', 'discarded'],
    requiresNote: [],
    since: 'R2',
    subjectKind: 'source',
  },
  {
    id: 'brief.approval',
    label: 'Aprovação da pauta',
    roles: ['approver', 'admin'],
    decisions: ['approved', 'changes_requested', 'rejected'],
    requiresNote: ['changes_requested', 'rejected'],
    since: 'R3',
    subjectKind: 'brief',
  },
  {
    id: 'outline.approval',
    label: 'Aprovação da estrutura',
    pieceKind: 'outline',
    roles: ['approver', 'admin'],
    decisions: ['approved', 'changes_requested'],
    requiresNote: ['changes_requested'],
    since: 'R3',
    subjectKind: 'version',
  },
  {
    id: 'cut.approval',
    label: 'Aprovação do corte',
    pieceKind: 'cut',
    roles: ['approver', 'creative_reviewer', 'admin'],
    decisions: ['approved', 'changes_requested'],
    requiresNote: ['changes_requested'],
    since: 'R4',
    subjectKind: 'version',
  },
  {
    id: 'script.approval',
    label: 'Aprovação do roteiro',
    pieceKind: 'script',
    roles: ['approver', 'admin'],
    decisions: ['approved', 'changes_requested'],
    requiresNote: ['changes_requested'],
    since: 'R5',
    subjectKind: 'version',
  },
  {
    id: 'asset.approval',
    label: 'Aprovação de avatar e voz',
    roles: ['approver', 'admin'],
    decisions: ['approved', 'rejected'],
    requiresNote: ['rejected'],
    since: 'R5',
    subjectKind: 'asset',
  },
  {
    id: 'media.approval',
    label: 'Aprovação de áudio e vídeo',
    roles: ['approver', 'creative_reviewer', 'admin'],
    decisions: ['approved', 'changes_requested'],
    requiresNote: ['changes_requested'],
    since: 'R5',
    subjectKind: 'version',
  },
  {
    id: 'creative.approval',
    label: 'Aprovação do criativo',
    roles: ['creative_reviewer', 'approver', 'admin'],
    decisions: ['approved', 'changes_requested'],
    requiresNote: ['changes_requested'],
    since: 'R6',
    subjectKind: 'version',
  },
  {
    id: 'newsletter.approval',
    label: 'Aprovação da newsletter',
    pieceKind: 'newsletter',
    roles: ['approver', 'admin'],
    decisions: ['approved', 'changes_requested'],
    requiresNote: ['changes_requested'],
    since: 'R6',
    subjectKind: 'version',
  },
];

export function gatesFor(release: ReleaseId = CURRENT_RELEASE): GateEntry[] {
  return availableIn(GATES, release);
}

export function gateById(id: GateId): GateEntry | undefined {
  return GATES.find((gate) => gate.id === id);
}
