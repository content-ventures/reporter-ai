'use client';

import { copilotTool } from '@/registries';
import { useCommandGroup } from '@/ui/shell';
import type { ImageSlotUse } from '@/domain';
import type { ArticleFacts, documentTools } from './studio-model';
import type { ImageToCheck } from './image-model';
import type { StudioDialog } from './studio-types';

/**
 * The "Artigo" group of ⌘K: what the studio offers right now, in the order a person reaches for
 * it — marking the text as reviewed, the assistant, images, the article-wide AI tools and
 * what lives behind ⋯ (history, structure, how the AI wrote, the brief). Nothing that only moves
 * panels around.
 */
export function useStudioCommands({
  facts,
  imageIssues,
  imageSlots,
  tools,
  generating,
  editable,
  hasCover,
  actions,
}: {
  facts: Pick<ArticleFacts, 'review' | 'missingQuotes'>;
  imageIssues: readonly ImageToCheck[];
  /** Suggested images still to fill ("Imagens sugeridas"). */
  imageSlots: readonly ImageSlotUse[];
  tools: ReturnType<typeof documentTools>;
  generating: boolean;
  /** The text may change here (not locked, not another tab's, the viewer edits). */
  editable: boolean;
  hasCover: boolean;
  actions: {
    saveVersion: () => Promise<void>;
    focusComposer: () => void;
    markTextReviewed: () => void;
    nextMissingQuote: () => void;
    nextImageIssue: () => void;
    nextImageSlot: () => void;
    insertImage: () => void;
    openCover: () => void;
    runTool: (toolId: string) => void;
    openDialog: (dialog: StudioDialog) => void;
    showChecks: () => void;
  };
}) {
  const writing = editable && !generating;
  useCommandGroup({
    label: 'Artigo',
    items: [
      ...(writing ? [{ id: 'article-save-version', label: 'Salvar versão', hint: '⌘S', onSelect: () => void actions.saveVersion() }] : []),
      ...(writing && facts.review === 'pending' ? [{ id: 'article-mark-reviewed', label: 'Marcar o texto como revisado', onSelect: actions.markTextReviewed }] : []),
      ...(facts.missingQuotes.length > 0
        ? [{ id: 'article-next-quote', label: 'Ir à próxima citação que não confere', description: `${facts.missingQuotes.length} na Checagem`, onSelect: actions.nextMissingQuote }]
        : []),
      { id: 'article-checks', label: 'Ver Checagem', onSelect: actions.showChecks },
      ...(writing ? [{ id: 'article-assistant', label: 'Pedir ao Assistente', onSelect: actions.focusComposer }] : []),
      ...(writing
        ? [
            { id: 'article-insert-image', label: 'Inserir imagem', description: 'Texto', onSelect: actions.insertImage },
            { id: 'article-cover', label: hasCover ? 'Trocar imagem de destaque' : 'Imagem de destaque', onSelect: actions.openCover },
          ]
        : []),
      ...(imageIssues.length > 0 ? [{ id: 'article-next-image', label: 'Próxima imagem a conferir', description: `${imageIssues.length} na Checagem`, onSelect: actions.nextImageIssue }] : []),
      ...(imageSlots.length > 0 && !generating
        ? [{ id: 'article-next-slot', label: 'Próxima imagem a preencher', description: `${imageSlots.length} imagens sugeridas`, onSelect: actions.nextImageSlot }]
        : []),
      ...(writing
        ? tools.map((tool) => ({ id: `article-${tool.id}`, label: tool.label ?? copilotTool(tool.id)?.label ?? tool.id, description: 'IA', onSelect: () => actions.runTool(tool.id) }))
        : []),
      { id: 'article-history', label: 'Histórico de versões', onSelect: () => actions.openDialog('history') },
      { id: 'article-structure', label: 'Ver estrutura', onSelect: () => actions.openDialog('structure') },
      { id: 'article-trace', label: 'Como a IA escreveu', onSelect: () => actions.openDialog('trace') },
      { id: 'article-brief', label: 'Editar pauta', onSelect: () => actions.openDialog('brief') },
    ],
  });
}
