'use client';

import {
  Button,
  Toolbar,
  ToolbarButton,
  ToolbarGroup,
  ToolbarMenu,
  ToolbarSeparator,
  ToolbarToggle,
  type MenuItem,
} from '@content-ventures/design-system/v3';
import {
  BookOpen,
  Bold,
  Heading2,
  Heading3,
  Image as ImageIcon,
  Italic,
  Link2,
  List as ListIcon,
  ListOrdered,
  Pilcrow,
  Redo2,
  Sparkles,
  TextQuote,
  Underline,
  Undo2,
  type LucideIcon,
} from '@content-ventures/design-system/v3/icons';
import { redo, setBlockKind, toggleMark, undo, useArticleToolbarState, type BlockKind } from '@/editor';
import { copilotTool } from '@/registries';
import { useStudio } from './studio-context';
import { StudioSaveState } from './studio-footer';

/**
 * The article toolbar (D2, COPY §2.2), the formatting a writer expects from a text editor and
 * nothing a CMS would not keep: Desfazer · Refazer | Parágrafo ▾ | Negrito · Itálico · Sublinhado |
 * Lista · Lista numerada · Citação | Link · Imagem | IA ▾ — then, at the end, "Salvo" and the two
 * buttons that open the panel ("Material", "Assistente"). What does not fit goes to "Mais". While
 * the text waits for approval (or another tab edits it) every control says why it is off; someone
 * who only reads the article gets the end of the bar only.
 */

const STYLES: { kind: BlockKind; label: string; icon: LucideIcon }[] = [
  { kind: 'paragraph', label: 'Parágrafo', icon: Pilcrow },
  { kind: 'heading2', label: 'Intertítulo', icon: Heading2 },
  { kind: 'heading3', label: 'Subtítulo', icon: Heading3 },
];

const STYLE_LABEL: Record<string, string> = {
  paragraph: 'Parágrafo',
  heading2: 'Intertítulo',
  heading3: 'Subtítulo',
  quote: 'Citação',
  bulletList: 'Lista',
  orderedList: 'Lista numerada',
  divider: 'Divisória',
  figure: 'Imagem',
};

/** Writer names of the assistant tools where the registry still says otherwise (COPY §2.2). */
const TOOL_LABELS: Partial<Record<string, string>> = {
  'expand-with-source': 'Expandir com a entrevista',
  titles: 'Títulos alternativos',
};

/**
 * The "IA" menus (toolbar and selection): "Trecho" — Mais direto · Encurtar · Reescrever
 * (Didático, Formal, Expandir com a entrevista, Virar lista) · Pedir… — and, with `document`,
 * "Artigo inteiro": the article-wide tools that apply to the text on screen (`documentTools`).
 */
export function aiMenuItems(
  run: (toolId: string) => void,
  options: { document?: readonly { id: string; label?: string }[]; onAsk?: () => void } = {},
): { passage: MenuItem[]; rewrite: MenuItem[]; document: MenuItem[] } {
  const item = (id: string, label?: string): MenuItem | null => {
    const tool = copilotTool(id);
    return tool ? { label: label ?? TOOL_LABELS[id] ?? tool.label, onSelect: () => run(id) } : null;
  };
  const present = (entries: (MenuItem | null)[]): MenuItem[] => entries.filter((entry): entry is MenuItem => entry !== null);
  const rewrite = present([item('rewrite.didactic'), item('rewrite.formal'), item('expand-with-source'), item('to-list')]);
  const passage = present([
    item('rewrite.direct'),
    item('shorten'),
    { label: 'Reescrever', items: rewrite },
    options.onAsk ? { label: 'Pedir…', onSelect: options.onAsk } : null,
  ]);
  const document = present((options.document ?? []).map((entry) => item(entry.id, entry.label)));
  return { passage, rewrite, document };
}

export function EditorToolbar({ onLink }: { onLink: () => void }) {
  const studio = useStudio();
  const { editor, panes } = studio;
  const state = useArticleToolbarState(editor);
  const generating = studio.generation.active;
  const reason = studio.refusal ?? (generating ? 'Aguarde a IA terminar.' : 'Clique no texto para editar.');
  const disabled = !editor || !state.editable || Boolean(studio.refusal);
  const figureSelected = state.block === 'figure';
  const { passage, document } = aiMenuItems((id) => studio.actions.runTool(id), {
    document: studio.documentTools,
    onAsk: () => studio.actions.askAboutSelection(),
  });
  const block = (kind: BlockKind) => () => editor && setBlockKind(editor, state.block === kind ? 'paragraph' : kind);

  const end = (
    <>
      {studio.canEdit ? <StudioSaveState /> : null}
      <Button size="sm" variant="ghost" icon={BookOpen} aria-pressed={panes.visibleTab === 'material'} onClick={() => panes.togglePanel('material')}>
        Material
      </Button>
      <Button size="sm" variant="ghost" icon={Sparkles} aria-pressed={panes.visibleTab === 'assistant'} onClick={() => panes.togglePanel('assistant')}>
        Assistente
      </Button>
    </>
  );

  if (!studio.canEdit) {
    return (
      <Toolbar label="Formatação do texto" keepFocus end={end}>
        {null}
      </Toolbar>
    );
  }

  return (
    <Toolbar label="Formatação do texto" keepFocus end={end}>
      <ToolbarGroup label="Histórico">
        <ToolbarButton
          label="Desfazer"
          icon={Undo2}
          shortcut="⌘Z"
          disabled={disabled || !state.canUndo}
          disabledReason={disabled ? reason : 'Nada para desfazer'}
          onClick={() => editor && undo(editor)}
        />
        <ToolbarButton
          label="Refazer"
          icon={Redo2}
          shortcut="⇧⌘Z"
          disabled={disabled || !state.canRedo}
          disabledReason={disabled ? reason : 'Nada para refazer'}
          onClick={() => editor && redo(editor)}
        />
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarMenu
        label="Estilo do parágrafo"
        value={state.block ? (STYLE_LABEL[state.block] ?? 'Parágrafo') : 'Parágrafo'}
        width={148}
        keep
        disabled={disabled || figureSelected}
        disabledReason={figureSelected && !disabled ? 'Uma imagem não tem estilo de texto' : reason}
        sections={[
          {
            items: STYLES.map((style) => ({
              label: style.label,
              icon: style.icon,
              checked: state.block === style.kind,
              onSelect: () => editor && setBlockKind(editor, style.kind),
            })),
          },
        ]}
      />
      <ToolbarSeparator />
      <ToolbarGroup label="Estilo do texto">
        <ToolbarToggle label="Negrito" icon={Bold} shortcut="⌘B" pressed={state.bold} disabled={disabled || figureSelected} disabledReason={reason} onPressedChange={() => editor && toggleMark(editor, 'bold')} />
        <ToolbarToggle label="Itálico" icon={Italic} shortcut="⌘I" pressed={state.italic} disabled={disabled || figureSelected} disabledReason={reason} onPressedChange={() => editor && toggleMark(editor, 'italic')} />
        <ToolbarToggle label="Sublinhado" icon={Underline} shortcut="⌘U" pressed={state.underline} disabled={disabled || figureSelected} disabledReason={reason} onPressedChange={() => editor && toggleMark(editor, 'underline')} />
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarGroup label="Listas e citação">
        <ToolbarToggle label="Lista" icon={ListIcon} pressed={state.block === 'bulletList'} disabled={disabled || figureSelected} disabledReason={reason} onPressedChange={block('bulletList')} />
        <ToolbarToggle label="Lista numerada" icon={ListOrdered} pressed={state.block === 'orderedList'} disabled={disabled || figureSelected} disabledReason={reason} onPressedChange={block('orderedList')} />
        <ToolbarToggle label="Citação" icon={TextQuote} pressed={state.block === 'quote'} disabled={disabled || figureSelected} disabledReason={reason} onPressedChange={block('quote')} />
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarButton
        label={state.link ? 'Editar link' : 'Link'}
        icon={Link2}
        pressed={state.link}
        disabled={disabled || figureSelected}
        disabledReason={figureSelected && !disabled ? 'Selecione um trecho para criar link' : reason}
        onClick={onLink}
      />
      <ToolbarButton label="Imagem" icon={ImageIcon} keep disabled={disabled} disabledReason={reason} onClick={() => studio.images.insertImage()} />
      <ToolbarSeparator />
      <ToolbarMenu
        label="IA"
        icon={Sparkles}
        showLabel
        keep
        disabled={disabled || studio.empty}
        disabledReason={disabled ? reason : 'Escreva o texto primeiro'}
        sections={[{ label: 'Trecho', items: passage }, ...(document.length > 0 ? [{ label: 'Artigo inteiro', items: document }] : [])]}
      />
    </Toolbar>
  );
}
