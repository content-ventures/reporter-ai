'use client';

import {
  Toolbar,
  useWorkspace,
  ToolbarButton,
  ToolbarGroup,
  ToolbarMenu,
  ToolbarSeparator,
  ToolbarToggle,
  type MenuItem,
} from '@content-ventures/design-system/v3';
import {
  Bold,
  CheckCheck,
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
  Strikethrough,
  TextQuote,
  Underline,
  Undo2,
  type LucideIcon,
} from '@content-ventures/design-system/v3/icons';
import { redo, setBlockKind, toggleMark, undo, useArticleToolbarState, useSelectionInfo, type BlockKind } from '@/editor';
import { copilotTool } from '@/registries';
import { useStudio } from './studio-context';
import { StudioSaveState, VersionMenu } from './studio-footer';

/**
 * Semantic toolbar of the article (PLAN §3.5): Desfazer/Refazer · Estilo ▾ (Texto, Intertítulo,
 * Subtítulo, Citação) · B I U S · listas · link · imagem · ✦ IA ▾. No highlighter, fonts, sizes,
 * colours, alignment or code: the text stays faithful to the CMS. What does not fit goes to "Mais".
 */

const STYLES: { kind: BlockKind; label: string; icon: LucideIcon }[] = [
  { kind: 'paragraph', label: 'Texto', icon: Pilcrow },
  { kind: 'heading2', label: 'Intertítulo', icon: Heading2 },
  { kind: 'heading3', label: 'Subtítulo', icon: Heading3 },
  { kind: 'quote', label: 'Citação', icon: TextQuote },
];

const STYLE_LABEL: Record<string, string> = {
  paragraph: 'Texto',
  heading2: 'Intertítulo',
  heading3: 'Subtítulo',
  quote: 'Citação',
  bulletList: 'Lista',
  orderedList: 'Lista numerada',
  divider: 'Divisória',
  figure: 'Imagem',
};

/**
 * Items of the "✦ IA" menus (toolbar and selection bar): the copilot registry, by id. With
 * `document`, the article-wide tools that apply to the text on screen (`documentTools`).
 */
export function aiMenuItems(run: (toolId: string) => void, options: { document?: readonly { id: string; label?: string }[] } = {}): MenuItem[][] {
  const item = (id: string, extra: Partial<MenuItem> = {}): MenuItem | null => {
    const tool = copilotTool(id);
    return tool ? { label: tool.label, onSelect: () => run(id), ...extra } : null;
  };
  const rewrite: MenuItem = {
    label: 'Reescrever',
    icon: Sparkles,
    items: [item('rewrite.direct'), item('rewrite.didactic'), item('rewrite.formal')].filter((entry): entry is MenuItem => entry !== null),
  };
  const passage = [rewrite, item('shorten'), item('expand-with-source'), item('to-list')].filter((entry): entry is MenuItem => entry !== null);
  if (!options.document) return [passage];
  const document = options.document
    .map((entry) => item(entry.id, entry.label ? { label: entry.label } : {}))
    .filter((entry): entry is MenuItem => entry !== null);
  return [passage, document];
}

export function EditorToolbar({ onLink }: { onLink: () => void }) {
  const studio = useStudio();
  const { editor } = studio;
  const state = useArticleToolbarState(editor);
  const disabled = !editor || !state.editable;
  const figureSelected = state.block === 'figure';
  const streamingReason = 'Aguarde a geração terminar este trecho.';
  const [passage, document] = aiMenuItems((id) => studio.actions.runTool(id), { document: studio.documentTools });
  const selection = useSelectionInfo(editor);
  const unreviewedHere = selection.blockIds.filter((id) => studio.facts.unreviewed.includes(id));
  // Desktop: the document's state ("Salvo · há 1 min", "v2 ▾") closes the toolbar line, as the
  // studio has no footer there. Narrow keeps the footer with the full save state.
  const narrow = useWorkspace()?.narrow ?? false;

  return (
    <Toolbar
      label="Formatação do texto"
      keepFocus
      end={
        narrow ? undefined : (
          <>
            <StudioSaveState />
            <VersionMenu />
          </>
        )
      }
    >
      <ToolbarGroup label="Histórico">
        <ToolbarButton
          label="Desfazer"
          icon={Undo2}
          shortcut="⌘Z"
          disabled={disabled || !state.canUndo}
          disabledReason="Nada para desfazer"
          onClick={() => editor && undo(editor)}
        />
        <ToolbarButton
          label="Refazer"
          icon={Redo2}
          shortcut="⇧⌘Z"
          disabled={disabled || !state.canRedo}
          disabledReason="Nada para refazer"
          onClick={() => editor && redo(editor)}
        />
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarMenu
        label="Estilo do parágrafo"
        value={state.block ? STYLE_LABEL[state.block] : 'Texto'}
        width={132}
        keep
        disabled={disabled || figureSelected}
        disabledReason={figureSelected ? 'Uma imagem não tem estilo de texto' : streamingReason}
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
        <ToolbarToggle label="Negrito" icon={Bold} shortcut="⌘B" pressed={state.bold} disabled={disabled || figureSelected} onPressedChange={() => editor && toggleMark(editor, 'bold')} />
        <ToolbarToggle label="Itálico" icon={Italic} shortcut="⌘I" pressed={state.italic} disabled={disabled || figureSelected} onPressedChange={() => editor && toggleMark(editor, 'italic')} />
        <ToolbarToggle label="Sublinhado" icon={Underline} shortcut="⌘U" pressed={state.underline} disabled={disabled || figureSelected} onPressedChange={() => editor && toggleMark(editor, 'underline')} />
        <ToolbarToggle label="Tachado" icon={Strikethrough} shortcut="⇧⌘S" pressed={state.strike} disabled={disabled || figureSelected} onPressedChange={() => editor && toggleMark(editor, 'strike')} />
      </ToolbarGroup>
      <ToolbarSeparator />
      <ToolbarGroup label="Listas">
        <ToolbarToggle label="Lista" icon={ListIcon} pressed={state.block === 'bulletList'} disabled={disabled || figureSelected} onPressedChange={() => editor && setBlockKind(editor, 'bulletList')} />
        <ToolbarToggle label="Lista numerada" icon={ListOrdered} pressed={state.block === 'orderedList'} disabled={disabled || figureSelected} onPressedChange={() => editor && setBlockKind(editor, 'orderedList')} />
      </ToolbarGroup>
      <ToolbarButton
        label={state.link ? 'Editar link' : 'Link'}
        icon={Link2}
        pressed={state.link}
        disabled={disabled || figureSelected}
        disabledReason={figureSelected ? 'Selecione um trecho para criar link' : streamingReason}
        onClick={onLink}
      />
      <ToolbarButton
        label="Inserir imagem"
        icon={ImageIcon}
        // Stays on the bar on a laptop; "Link" (also on the selection bar) goes to "Mais" first.
        keep
        disabled={disabled}
        disabledReason={streamingReason}
        onClick={() => studio.images.insertImage()}
      />
      <ToolbarSeparator />
      <ToolbarMenu
        label="IA"
        icon={Sparkles}
        showLabel
        keep
        disabled={studio.empty}
        disabledReason="Escreva ou gere o texto primeiro"
        sections={[{ items: passage ?? [] }, ...(document && document.length > 0 ? [{ label: 'Artigo', items: document }] : [])]}
      />
      {unreviewedHere.length > 0 ? (
        <>
          <ToolbarSeparator />
          <ToolbarButton label="Marcar como revisado" icon={CheckCheck} showLabel onClick={() => studio.actions.markReviewed(unreviewedHere)} />
        </>
      ) : null}
    </Toolbar>
  );
}
