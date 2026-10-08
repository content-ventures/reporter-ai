import type { ActivityEvent } from '../../../domain/activity.ts';
import { DECISION_LABELS } from '../../../domain/decision.ts';
import type { DecisionKind } from '../../../domain/decision.ts';
import { PIECE_LABELS } from '../../../domain/piece.ts';
import type { PieceKind } from '../../../domain/piece.ts';
import { RUN_KIND_LABELS } from '../../../domain/run.ts';
import type { RunKind } from '../../../domain/run.ts';
import type { PersonSummary } from '../../../ports/common.ts';

/** pt-BR timeline lines for semantic activity ("Pedro Alves aprovou o artigo v4"). */

/** "o artigo", "o carrossel" (`data.piece` is a kind; an older saved label still reads right). */
function pieceName(data: ActivityEvent['data']): string {
  const piece = typeof data?.piece === 'string' ? data.piece : undefined;
  const kind = piece && piece in PIECE_LABELS ? (piece as PieceKind) : (Object.entries(PIECE_LABELS) as [PieceKind, string][]).find(([, label]) => label === piece)?.[0];
  return kind ? `o ${PIECE_LABELS[kind].toLowerCase()}` : 'o texto';
}

function versionTag(data: ActivityEvent['data']): string {
  return typeof data?.number === 'number' ? ` v${data.number}` : '';
}

function runName(data: ActivityEvent['data']): string {
  const kind = data?.runKind as RunKind | undefined;
  return kind && kind in RUN_KIND_LABELS ? RUN_KIND_LABELS[kind] : 'Geração';
}

export function activitySummary(event: ActivityEvent, actor: PersonSummary | null): string {
  const who = actor?.name ?? 'Sistema';
  const data = event.data;
  switch (event.type) {
    case 'production.created':
      return `${who} criou a produção`;
    case 'production.archived':
      return `${who} arquivou a produção`;
    case 'source.added':
      return typeof data?.title === 'string' ? `${who} adicionou o material “${data.title}”` : `${who} adicionou o material`;
    case 'source.revised':
      return `${who} corrigiu o material${versionTag(data)}`;
    case 'source.authorized':
      return `${who} autorizou o material`;
    case 'run.started':
      return `${runName(data)} iniciada por ${who}`;
    case 'run.completed':
      return `${runName(data)} concluída`;
    case 'run.failed':
      return `${runName(data)} falhou`;
    case 'run.cancelled':
      return `${runName(data)} interrompida`;
    case 'version.created':
      if (data?.origin === 'generation') {
        // "Parte escrita d o artigo guardada como v1" → "Parte escrita do artigo guardada como v1".
        return data.interrupted === true
          ? `Parte escrita d${pieceName(data)} guardada como${versionTag(data) || ' versão'}`
          : `Versão${versionTag(data)} · IA d${pieceName(data)} pronta`;
      }
      return `${who} salvou ${pieceName(data)}${versionTag(data)}`;
    case 'version.restored':
      // "d" + "o artigo" → "do artigo"; "d" + "a peça" → "da peça".
      return typeof data?.from === 'number'
        ? `${who} restaurou a v${data.from} d${pieceName(data)} como v${data.number}`
        : `${who} restaurou uma versão d${pieceName(data)}`;
    case 'review.requested':
      return `${who} enviou ${pieceName(data)}${versionTag(data)} para aprovação`;
    case 'decision.recorded': {
      const decision = data?.decision as DecisionKind | undefined;
      if (decision === 'approved') return `${who} aprovou ${pieceName(data)}${versionTag(data)}`;
      if (decision === 'changes_requested') return `${who} pediu ajustes n${pieceName(data)}${versionTag(data)}`;
      return `${who} registrou “${decision ? DECISION_LABELS[decision] : 'decisão'}” em ${pieceName(data)}${versionTag(data)}`;
    }
    case 'suggestion.applied':
      return typeof data?.label === 'string' ? `${who} aceitou a sugestão “${data.label}”` : `${who} aceitou uma sugestão da IA`;
    case 'suggestion.discarded':
      return typeof data?.label === 'string' ? `${who} descartou a sugestão “${data.label}”` : `${who} descartou uma sugestão da IA`;
    case 'delivery.completed':
      return typeof data?.files === 'number' ? `${who} exportou o pacote (${data.files} arquivos)` : `${who} exportou o pacote`;
    case 'delivery.failed':
      return 'A exportação do pacote falhou';
    case 'feedback.recorded':
      return `${who} registrou um retorno`;
  }
}
