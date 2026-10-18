'use client';

import { List, ListItem, MetaList, Section, SuggestionCard } from '@content-ventures/design-system/v3';
import { Link2, Quote } from '@content-ventures/design-system/v3/icons';
import { quoteBlock } from '@/domain';
import type { EnrichmentSuggestion } from '@/domain/hard-news';
import { insertBlocks, setLink, textRangeToPositions } from '@/editor';
import { useStudio } from '@/features/studio/article/studio-context';
import { formatCount } from '@/ui/format';
import { DemoBadge } from '../demo-badge';
import { useHardNews } from '../state/hard-news-provider';
import { locateText } from './evidence-model';
import type { DeskStudio } from './use-desk-studio';

/**
 * F2.13 · the portal's own context for this text: quotes of the bank and links to published
 * articles, each with where it comes from (REQ-T.7). Accepting writes it into the text at the
 * place it fits, as one undoable step; nothing enters the text without a person.
 */
export function EnrichmentSection({ desk }: { desk: DeskStudio }) {
  const studio = useStudio();
  const { actions } = useHardNews();
  const pending = desk.suggestions.filter((item) => item.state === 'pending');
  const decided = desk.suggestions.filter((item) => item.state !== 'pending');
  const productionId = desk.dossier.productionId;
  const editable = studio.canEdit && !studio.readOnly && !studio.locked;

  function accept(suggestion: EnrichmentSuggestion) {
    const editor = studio.editor;
    const range = locateText(studio.body, suggestion.anchor);
    if (!editor || editor.isDestroyed || !range) return;
    if (suggestion.kind === 'quote') {
      const author = suggestion.origin.author?.split(',')[0] ?? 'a fonte';
      const block = quoteBlock(`enr-${suggestion.id}`, `“${suggestion.text}”, disse ${author}.`, { ai: 'unreviewed' });
      insertBlocks(editor, [block], { after: range.blockId });
    } else if (suggestion.origin.url) {
      const positions = textRangeToPositions(editor.state.doc, range);
      if (!positions) return;
      editor.chain().setTextSelection(positions).run();
      setLink(editor, suggestion.origin.url);
    }
    actions.decideSuggestion(productionId, suggestion.id, 'accepted');
  }

  if (desk.suggestions.length === 0) return null;
  return (
    <Section title="Do acervo" titleAs="h3" meta={pending.length ? `${formatCount(pending.length)} sugestões` : undefined} action={<DemoBadge />}>
      {pending.map((suggestion) => (
        <SuggestionCard
          key={suggestion.id}
          variant="compact"
          titleAs="h4"
          title={suggestion.kind === 'quote' ? `Fala de ${suggestion.origin.author?.split(',')[0] ?? 'fonte'}` : 'Link interno'}
          provenance={[suggestion.origin.title, new Date(suggestion.origin.date).toLocaleDateString('pt-BR')]}
          proposal={suggestion.kind === 'quote' ? `“${suggestion.text}”` : `“${suggestion.anchor}” → ${suggestion.text}`}
          meta={suggestion.why}
          state="ready"
          mode={suggestion.kind === 'quote' ? 'insert' : 'replace'}
          acceptLabel={suggestion.kind === 'quote' ? 'Inserir fala' : 'Inserir link'}
          acceptBlockedReason={editable ? undefined : 'O texto não pode ser editado agora.'}
          shortcuts={false}
          onAccept={() => accept(suggestion)}
          onInsert={suggestion.kind === 'quote' ? () => accept(suggestion) : undefined}
          onDiscard={() => actions.decideSuggestion(productionId, suggestion.id, 'rejected')}
        />
      ))}
      {decided.length > 0 ? (
        <List label="Sugestões decididas" framed={false} bleed>
          {decided.map((suggestion) => (
            <ListItem
              key={suggestion.id}
              icon={suggestion.kind === 'quote' ? Quote : Link2}
              title={suggestion.kind === 'quote' ? `“${suggestion.text}”` : suggestion.text}
              description={<MetaList size="sm" items={[suggestion.state === 'accepted' ? 'Inserida' : 'Recusada', suggestion.origin.title]} />}
            />
          ))}
        </List>
      ) : null}
    </Section>
  );
}
