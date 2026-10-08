'use client';

import { toast } from '@content-ventures/design-system/v3';
import { copilotTool } from '@/registries';
import { useCommandGroup, type FocusMode } from '@/ui/shell';
import type { ArticleFacts, documentTools } from './studio-model';
import type { ImageToCheck } from './image-model';
import type { StudioText } from './use-studio-text';

/** The "Artigo" group of ⌘K: what the studio offers right now, in the order a person reaches for it. */
export function useStudioCommands({
  text,
  facts,
  imageIssues,
  tools,
  generating,
  requestBlocked,
  requestFix,
  reviewLink,
  focusMode,
  actions,
}: {
  text: Pick<StudioText, 'body' | 'images'>;
  facts: Pick<ArticleFacts, 'unreviewed' | 'missingQuotes'>;
  imageIssues: readonly ImageToCheck[];
  tools: ReturnType<typeof documentTools>;
  generating: boolean;
  requestBlocked: string | null;
  /** Where a blocked "Enviar para aprovação" takes the person (the reason shows beside it). */
  requestFix: 'suggestions' | 'checks' | null;
  /** Nothing new to send: the review (or the approved version) instead. */
  reviewLink: { label: string } | null;
  focusMode: FocusMode;
  actions: {
    saveVersion: () => Promise<void>;
    focusComposer: () => void;
    nextAiBlock: () => void;
    nextMissingQuote: () => void;
    nextImageIssue: () => void;
    nextSuggestion: () => void;
    showChecks: () => void;
    togglePanels: () => void;
    runTool: (toolId: string) => void;
    requestReview: () => Promise<void>;
    openReview: () => void;
  };
}) {
  const { body, images } = text;
  const { saveVersion, focusComposer, nextAiBlock, nextMissingQuote, nextImageIssue, nextSuggestion, showChecks, togglePanels, runTool, requestReview, openReview } = actions;
  // Blocked, "Enviar para aprovação" stays listed with its reason and leads to what unblocks it.
  const sendBlocked = () => {
    if (requestFix === 'suggestions') nextSuggestion();
    else if (requestFix === 'checks') showChecks();
    else if (requestBlocked) toast('Ainda não dá para enviar', { tone: 'info', description: requestBlocked });
  };
  useCommandGroup({
    label: 'Artigo',
    items: [
      { id: 'article-save-version', label: 'Salvar versão', hint: '⌘S', onSelect: () => void saveVersion() },
      { id: 'article-composer', label: 'Focar no compositor', description: 'Copiloto', onSelect: focusComposer },
      ...(facts.unreviewed.length > 0
        ? [{ id: 'article-next-ai', label: 'Próximo bloco da IA', description: `${facts.unreviewed.length} a revisar`, onSelect: nextAiBlock }]
        : []),
      ...(facts.missingQuotes.length > 0
        ? [{ id: 'article-next-quote', label: 'Próxima citação não conferida', description: `${facts.missingQuotes.length} sem fonte`, onSelect: nextMissingQuote }]
        : []),
      ...(generating
        ? []
        : [
            { id: 'article-insert-image', label: 'Inserir imagem', description: 'Texto', onSelect: () => images.insertImage() },
            {
              id: 'article-cover',
              label: body.cover ? 'Trocar imagem de destaque' : 'Adicionar imagem de destaque',
              onSelect: () => images.openCover('choose'),
            },
          ]),
      ...(imageIssues.length > 0
        ? [{ id: 'article-next-image', label: 'Próxima imagem a conferir', description: `Imagens com crédito · ${imageIssues.length}`, onSelect: nextImageIssue }]
        : []),
      { id: 'article-panels', label: 'Alternar painéis', onSelect: togglePanels },
      { id: 'article-focus', label: focusMode.focus ? 'Sair do modo foco' : 'Modo foco', onSelect: focusMode.toggle },
      ...tools.map((tool) => ({ id: `article-${tool.id}`, label: tool.label ?? copilotTool(tool.id)?.label ?? tool.id, description: 'IA', onSelect: () => runTool(tool.id) })),
      reviewLink
        ? { id: 'article-review', label: reviewLink.label, onSelect: openReview }
        : requestBlocked
          ? { id: 'article-review', label: 'Enviar para aprovação', description: requestBlocked, onSelect: sendBlocked }
          : { id: 'article-review', label: 'Enviar para aprovação', onSelect: () => void requestReview() },
    ],
  });
}
