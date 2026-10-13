'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Chip,
  Field,
  FloatingToolbar,
  Input,
  ResponsiveDialog,
  ToolbarButton,
  ToolbarMenu,
  ToolbarSeparator,
  ToolbarToggle,
} from '@content-ventures/design-system/v3';
import {
  Bold,
  Check,
  CircleStop,
  Italic,
  Link2,
  MessageSquareText,
  PanelLeftOpen,
  PanelRightOpen,
  PanelTop,
  Pencil,
  RefreshCcw,
  RefreshCw,
  Scissors,
  Sparkles,
  TextQuote,
  Trash2,
  Upload,
  X,
} from '@content-ventures/design-system/v3/icons';
import { imageIssues, LINK_REFUSAL_MESSAGES, type QuoteCheck, type Suggestion, type TextRange } from '@/domain';
import {
  blockRect,
  locateSuggestionInDoc,
  setArticleDecorations,
  setLink,
  textRangeRect,
  toggleMark,
  unsetLink,
  useArticleCover,
  useArticleToolbarState,
  useFigureAnchor,
  useSelectedFigure,
  useSelectionAnchor,
  useSelectionInfo,
  type FigureInfo,
  type SelectionInfo,
} from '@/editor';
import { arrivalOf, imageSource, type ImageSourceEntry } from '@/registries';
import { ICONS } from '@/ui/icons';
import { useMediaQuery } from '@/ui/use-media-query';
import { aiMenuItems } from './editor-toolbar';
import { issueLine } from './image-model';
import { useStudio } from './studio-context';
import { clip, closestExcerpt, suggestionDelta } from './studio-model';

/**
 * Floating layers over the text (PLAN §3.5 "IA inline"), one at a time:
 * 1. the selection bar — B I link | ✦ Reescrever ▾ · Encurtar · Perguntar à IA;
 * 2. the suggestion bar under the passage the AI is rewriting (opened by its card, the status line
 *    or the caret entering the passage) — Aceitar (⌘↵) · Descartar (Esc) · Tentar de novo,
 *    "Simulação local" in its label; the proposal reads in the paragraph itself;
 * 3. the image bar on a selected figure — Trocar · Editar legenda e crédito · Remover, with
 *    "Sem crédito" in red when the image has none; on a suggested image nobody filled (a slot),
 *    the slot bar instead — Enviar imagem · Usar link · Acervo and Gerar com IA "Em breve" ·
 *    Remover sugestão;
 * 4. the quotation bar with the caret in a quotation the material does not back — what the
 *    source says · Usar texto da fonte · Ver na transcrição.
 * They anchor to rectangles of the document and never take the focus from the text. The suggestion
 * and quotation bars sit under their block, and the block opens room for them (`data-bar-space`):
 * they never cover a line. (The review of the AI text is one for the whole text, in the footer.)
 */
export function FloatingBars({ onLink }: { onLink: () => void }) {
  const studio = useStudio();
  const { editor } = studio;
  const selection = useSelectionInfo(editor);
  const selectionKey = `${selection.from}:${selection.to}`;
  const [dismissedSelection, setDismissedSelection] = useState<string | null>(null);
  const [seenSelection, setSeenSelection] = useState(selectionKey);
  if (seenSelection !== selectionKey) {
    // A new selection (or the caret moving away) reopens the bar.
    setSeenSelection(selectionKey);
    if (dismissedSelection !== null) setDismissedSelection(null);
  }
  // A read-only tab (A10) offers no edits on a selection.
  const selectionOpen = Boolean(editor) && !selection.empty && dismissedSelection !== selectionKey && !studio.generation.active && !studio.readOnly;

  const suggestion = studio.focusedSuggestion;
  const pendingRun = studio.suggestionFocus?.runId && !suggestion && studio.activeAssist?.id === studio.suggestionFocus.runId ? studio.suggestionFocus : null;
  const suggestionKey = suggestion?.id ?? (pendingRun ? `run-${pendingRun.runId}` : null);
  // Focusing a card (or a new inline request) is a new focus, which brings a dismissed bar back.
  const suggestionOpen = !selectionOpen && suggestionKey !== null && !studio.suggestionBarHidden;

  const selected = useSelectedFigure(editor);
  // A suggested image nobody filled (an image slot) has its own bar.
  const slot = selected && !selected.assetId && selected.slot ? selected : null;
  const figure = slot ? null : selected;
  // Like the selection bar: dismissed for this image until another one (or the text) is selected.
  const [dismissedFigure, setDismissedFigure] = useState<string | null>(null);
  const figureKey = figure ? `${figure.blockId}:${figure.pos}:${studio.figureReveal}` : null;
  const [seenFigure, setSeenFigure] = useState(figureKey);
  if (seenFigure !== figureKey) {
    setSeenFigure(figureKey);
    if (dismissedFigure !== null) setDismissedFigure(null);
  }
  const figureOpen =
    !selectionOpen && !suggestionOpen && figure !== null && dismissedFigure !== figureKey && !studio.generation.active && studio.images.picker === null;

  const [dismissedSlot, setDismissedSlot] = useState<string | null>(null);
  const slotKey = slot ? `${slot.blockId}:${slot.pos}:${studio.figureReveal}` : null;
  const [seenSlot, setSeenSlot] = useState(slotKey);
  if (seenSlot !== slotKey) {
    setSeenSlot(slotKey);
    if (dismissedSlot !== null) setDismissedSlot(null);
  }
  // Filling waits for the generation; a read-only tab (A10) fills nothing.
  const slotOpen =
    !selectionOpen &&
    !suggestionOpen &&
    slot !== null &&
    dismissedSlot !== slotKey &&
    !studio.generation.active &&
    !studio.readOnly &&
    studio.images.picker === null;

  // The caret in a quotation the material does not back ("Falta"): what the source says, at hand.
  const caret = selection.empty ? selection.ranges[0] : undefined;
  const quote = caret
    ? studio.facts.quotes.find((entry) => entry.status === 'missing' && entry.range.blockId === caret.blockId && entry.range.from <= caret.from && caret.from <= entry.range.to)
    : undefined;
  const quoteKey = quote ? `${quote.range.blockId}:${quote.range.from}` : null;
  const [dismissedQuote, setDismissedQuote] = useState<string | null>(null);
  const [seenQuote, setSeenQuote] = useState(quoteKey);
  if (seenQuote !== quoteKey) {
    setSeenQuote(quoteKey);
    if (dismissedQuote !== null) setDismissedQuote(null);
  }
  const quoteOpen = !selectionOpen && !suggestionOpen && !figureOpen && !slotOpen && quote !== undefined && dismissedQuote !== quoteKey && !studio.generation.active;

  // The block under a bar opens room for it, so the bar never covers the next line (A06.3).
  const suggestionBlock = suggestionOpen ? suggestionBarBlock(editor, suggestion, studio.suggestionFocus?.target) : null;
  const roomFor = suggestionBlock ?? (quoteOpen && quote ? quote.range.blockId : null);
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    setArticleDecorations(editor.view, { barSpace: roomFor });
  }, [editor, roomFor]);

  return (
    <>
      <SelectionBar open={selectionOpen} selection={selection} onDismiss={() => setDismissedSelection(selectionKey)} onLink={onLink} />
      <SuggestionNearText open={suggestionOpen} onDismiss={studio.hideSuggestionBar} />
      <FigureBar open={figureOpen} figure={figure} onDismiss={() => setDismissedFigure(figureKey)} />
      <SlotBar open={slotOpen} slot={slot} onDismiss={() => setDismissedSlot(slotKey)} />
      <QuoteBar open={quoteOpen} quote={quote} onDismiss={() => setDismissedQuote(quoteKey)} />
    </>
  );
}

function SelectionBar({ open, selection, onDismiss, onLink }: { open: boolean; selection: SelectionInfo; onDismiss: () => void; onLink: () => void }) {
  const studio = useStudio();
  const { editor } = studio;
  const anchor = useSelectionAnchor(editor);
  const state = useArticleToolbarState(editor);
  const run = (toolId: string) => {
    onDismiss();
    studio.actions.runTool(toolId, { target: selection.ranges });
  };
  const { rewrite } = aiMenuItems(run);

  return (
    <FloatingToolbar open={open} anchor={anchor} label="Ações do trecho selecionado" onDismiss={onDismiss}>
      <ToolbarToggle label="Negrito" icon={Bold} shortcut="⌘B" pressed={state.bold} onPressedChange={() => editor && toggleMark(editor, 'bold')} />
      <ToolbarToggle label="Itálico" icon={Italic} shortcut="⌘I" pressed={state.italic} onPressedChange={() => editor && toggleMark(editor, 'italic')} />
      <ToolbarButton label={state.link ? 'Editar link' : 'Link'} icon={Link2} pressed={state.link} onClick={onLink} />
      <ToolbarSeparator />
      <ToolbarButton label="Mais direto" icon={Sparkles} showLabel onClick={() => run('rewrite.direct')} />
      <ToolbarButton label="Encurtar" icon={Scissors} showLabel onClick={() => run('shorten')} />
      <ToolbarMenu label="Reescrever" icon={Pencil} showLabel keep sections={[{ items: rewrite }]} />
      <ToolbarButton
        label="Pedir…"
        icon={MessageSquareText}
        showLabel
        onClick={() => {
          onDismiss();
          studio.actions.askAboutSelection();
        }}
      />
    </FloatingToolbar>
  );
}

/** The block a suggestion's bar sits under: the last one its passage reaches (where it is now). */
function suggestionBarBlock(
  editor: ReturnType<typeof useStudio>['editor'],
  suggestion: Pick<Suggestion, 'target' | 'anchorText'> | undefined,
  target: readonly TextRange[] | undefined,
): string | null {
  if (!editor || editor.isDestroyed) return null;
  const located = suggestion ? locateSuggestionInDoc(editor.state.doc, suggestion) : undefined;
  const ranges = located && located.length > 0 ? located : (suggestion?.target ?? target ?? []);
  return ranges[ranges.length - 1]?.blockId ?? null;
}

function SuggestionNearText({ open, onDismiss }: { open: boolean; onDismiss: () => void }) {
  const studio = useStudio();
  const { editor } = studio;
  // While the bar fades out after a decision, it keeps showing the suggestion it was about.
  const [last, setLast] = useState(studio.focusedSuggestion);
  if (studio.focusedSuggestion && studio.focusedSuggestion !== last) setLast(studio.focusedSuggestion);
  const suggestion = studio.focusedSuggestion ?? (open ? undefined : last);
  const target = suggestion?.target ?? studio.suggestionFocus?.target;
  const anchor = useCallback(() => {
    if (!editor || editor.isDestroyed || !target?.[0]) return null;
    // Under the whole (last) block, in the room it opens: the bar never covers a line.
    const blockId = suggestionBarBlock(editor, suggestion, target);
    return (blockId ? blockRect(editor.view, blockId) : null) ?? textRangeRect(editor.view, target[target.length - 1]);
  }, [editor, suggestion, target]);
  const state = suggestion ? studio.stateOf(suggestion) : 'streaming';
  const delta = suggestion ? suggestionDelta(suggestion) : undefined;
  // What the rewrite takes out and puts in: only the removed words are struck through in the text.
  const change = state === 'stale' ? 'Trecho mudou' : delta && (delta.removed > 0 || delta.added > 0) ? `−${delta.removed} +${delta.added} palavras` : null;
  // On a phone the decision keeps its place: a short label, and the secondary actions as icons.
  const narrow = useMediaQuery('(max-width: 640px)');
  // The model is said in the assistant (the run's "Ver detalhes"), not again on the bar.
  const label = (narrow ? [suggestion?.label ?? 'Gerando sugestão', state === 'stale' ? change : null] : [suggestion?.label ?? 'Gerando sugestão', change])
    .filter(Boolean)
    .join(' · ');

  return (
    <FloatingToolbar
      open={open}
      anchor={anchor}
      placement="bottom"
      follow
      label="Sugestão da IA"
      onDismiss={(reason) => (reason === 'outside' ? onDismiss() : undefined)}
    >
      <Chip size="sm" variant="soft" icon={Sparkles}>
        {label}
      </Chip>
      <ToolbarSeparator />
      {!suggestion ? (
        <ToolbarButton label="Parar" icon={CircleStop} showLabel shortcut="Esc" onClick={() => void studio.actions.stopAssist()} />
      ) : state === 'stale' ? (
        <>
          <ToolbarButton label="Reaplicar" icon={RefreshCcw} showLabel keep shortcut="⌘↵" onClick={() => void studio.actions.reapply(suggestion)} />
          <ToolbarButton label="Descartar" icon={X} showLabel={!narrow} shortcut="Esc" onClick={() => void studio.actions.discard(suggestion)} />
        </>
      ) : (
        <>
          <ToolbarButton
            label="Aceitar"
            icon={Check}
            showLabel
            keep
            shortcut="⌘↵"
            disabled={state !== 'ready' || studio.readOnly}
            disabledReason={studio.readOnly ? 'Aberta em outra aba' : 'Aguarde a sugestão terminar'}
            onClick={() => void studio.actions.accept(suggestion)}
          />
          <ToolbarButton
            label="Descartar"
            icon={X}
            showLabel={!narrow}
            shortcut="Esc"
            disabled={studio.readOnly}
            disabledReason="Aberta em outra aba"
            onClick={() => void studio.actions.discard(suggestion)}
          />
          <ToolbarButton
            label="Tentar de novo"
            icon={RefreshCcw}
            disabled={studio.readOnly}
            disabledReason="Aberta em outra aba"
            onClick={() => void studio.actions.reapply(suggestion)}
          />
        </>
      )}
      <ToolbarButton label="Ver no Assistente" icon={PanelRightOpen} onClick={() => studio.panes.showPanel('assistant')} />
    </FloatingToolbar>
  );
}

/**
 * The selected image: "Sem crédito" / "Uso não autorizado" in red when they apply, then Trocar
 * imagem · Editar legenda e crédito · Definir como destaque · Remover. Anchored to the figure;
 * keeps showing the image it was about while it fades out.
 */
function FigureBar({ open, figure, onDismiss }: { open: boolean; figure: FigureInfo | null; onDismiss: () => void }) {
  const studio = useStudio();
  const { editor, images } = studio;
  const [last, setLast] = useState(figure);
  if (figure && figure !== last) setLast(figure);
  const shown = figure ?? last;
  const anchor = useFigureAnchor(editor, shown?.blockId);
  const cover = useArticleCover(editor);
  const asset = shown?.assetId ? images.lookup(shown.assetId) : undefined;
  const issues = shown?.assetId ? imageIssues(asset) : [];
  const isCover = Boolean(shown?.assetId && cover?.assetId === shown.assetId);
  const act = (run: (blockId: string) => void) => () => {
    if (shown) run(shown.blockId);
  };

  return (
    // Escape hides it; a click elsewhere in the text moves the selection (and the bar goes with it),
    // so a click on the selected image itself never hides its actions.
    <FloatingToolbar open={open && shown !== null} anchor={anchor} placement="top" label="Ações da imagem" onDismiss={(reason) => (reason === 'escape' ? onDismiss() : undefined)}>
      {issues.length > 0 ? (
        <>
          <Badge tone="red" variant="text" size="sm">
            {issueLine(issues)}
          </Badge>
          <ToolbarSeparator />
        </>
      ) : null}
      <ToolbarButton label="Trocar imagem" icon={RefreshCw} showLabel onClick={act(images.replaceFigure)} />
      <ToolbarButton
        label="Editar legenda e crédito"
        icon={Pencil}
        showLabel
        keep
        disabled={!asset}
        disabledReason="Troque a imagem: o arquivo não está neste navegador."
        onClick={act((blockId) => images.editFigure(blockId))}
      />
      <ToolbarButton
        label="Definir como destaque"
        icon={PanelTop}
        showLabel
        disabled={isCover || !asset}
        disabledReason={isCover ? 'Já é a imagem de destaque' : 'Troque a imagem: o arquivo não está neste navegador.'}
        onClick={act(images.makeCover)}
      />
      <ToolbarSeparator />
      <ToolbarButton label="Remover" icon={Trash2} tone="danger" onClick={act(images.removeFigure)} />
    </FloatingToolbar>
  );
}

/** Image sources of later releases, offered on a suggestion as "Em breve" (R2 Acervo, R6 Gerar com IA). */
const SOON_SOURCES: readonly ImageSourceEntry[] = (['archive', 'generate'] as const)
  .map((id) => imageSource(id))
  .filter((entry): entry is ImageSourceEntry => entry !== undefined);

/**
 * A suggested image nobody filled yet (an image slot) selected: its frame already says what to
 * show. "Enviar imagem" and "Usar link" open the picker on that source, alt text and caption
 * started from the suggestion; "Acervo" (R2) and "Gerar com IA" (R6) wait as "Em breve" (reachable,
 * the reason in their tip); "Remover sugestão" takes it out of the text ("Desfazer" in the toast).
 * Anchored above the frame like the image bar; keeps showing its slot while it fades out.
 */
function SlotBar({ open, slot, onDismiss }: { open: boolean; slot: FigureInfo | null; onDismiss: () => void }) {
  const studio = useStudio();
  const { editor, images } = studio;
  const [last, setLast] = useState(slot);
  if (slot && slot !== last) setLast(slot);
  const shown = slot ?? last;
  const anchor = useFigureAnchor(editor, shown?.blockId);
  // On a phone the bar keeps "Enviar imagem" written; the rest as icons with their tips.
  const narrow = useMediaQuery('(max-width: 640px)');
  const act = (run: (blockId: string) => void) => () => {
    if (shown) run(shown.blockId);
  };

  return (
    <FloatingToolbar open={open && shown !== null} anchor={anchor} placement="top" label="Imagem sugerida" onDismiss={(reason) => (reason === 'escape' ? onDismiss() : undefined)}>
      <ToolbarButton label="Enviar imagem" icon={Upload} showLabel keep onClick={act((blockId) => images.fillSlot(blockId, { tab: 'upload' }))} />
      <ToolbarButton label="Usar link" icon={Link2} showLabel={!narrow} onClick={act((blockId) => images.fillSlot(blockId, { tab: 'link' }))} />
      <ToolbarSeparator />
      {SOON_SOURCES.map((source) => (
        <ToolbarButton key={source.id} label={source.label} icon={ICONS[source.icon]} disabled disabledReason={`${source.label} · Em breve. ${arrivalOf(source.since)}`} />
      ))}
      <ToolbarSeparator />
      <ToolbarButton label="Remover sugestão" icon={Trash2} tone="danger" onClick={act(images.dismissSlot)} />
    </FloatingToolbar>
  );
}

/**
 * A quotation the material does not back ("Falta"), with the caret in it: the closest line of the
 * transcript, "Usar texto da fonte" (its words replace the quotation; one ⌘Z reverts it) and "Ver
 * na transcrição" (the Fonte pane on that line, lit). Keeps showing its quotation while it fades.
 */
function QuoteBar({ open, quote, onDismiss }: { open: boolean; quote: QuoteCheck | undefined; onDismiss: () => void }) {
  const studio = useStudio();
  const { editor, sources } = studio;
  const [last, setLast] = useState(quote);
  if (quote && quote !== last) setLast(quote);
  const shown = quote ?? last;
  const closest = useMemo(() => (shown ? closestExcerpt(shown, sources) : undefined), [shown, sources]);
  const range = shown?.range;
  // Under the quotation's block, in the room it opens (never over the rest of the paragraph).
  const anchor = useCallback(
    () => (editor && !editor.isDestroyed && range ? (blockRect(editor.view, range.blockId) ?? textRangeRect(editor.view, range)) : null),
    [editor, range],
  );
  // On a phone the two actions keep their place as icons (with their tips) beside a shorter excerpt.
  const narrow = useMediaQuery('(max-width: 640px)');
  return (
    <FloatingToolbar open={open && shown !== undefined} anchor={anchor} placement="bottom" follow label="Citação sem fonte" onDismiss={onDismiss}>
      <Chip size="sm" variant="soft" icon={TextQuote}>
        {closest ? `Na fonte: “${clip(closest.text, narrow ? 28 : 72)}”` : 'Sem trecho parecido no material'}
      </Chip>
      {closest && range ? (
        <>
          <ToolbarSeparator />
          <ToolbarButton label="Usar texto da fonte" icon={TextQuote} showLabel={!narrow} onClick={() => studio.actions.useSourceText(range, closest.text)} />
          <ToolbarButton label="Ver na transcrição" icon={PanelLeftOpen} showLabel={!narrow} onClick={() => studio.actions.showInTranscript(closest.segmentId)} />
        </>
      ) : null}
    </FloatingToolbar>
  );
}

/** "Link": a small edit, so a dialog (DS rule: modals only confirm or edit a little). */
export function LinkDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const studio = useStudio();
  const { editor } = studio;
  const state = useArticleToolbarState(editor);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [session, setSession] = useState(open);
  if (open !== session) {
    setSession(open);
    if (open) {
      setValue(state.href ?? '');
      setError(undefined);
    }
  }
  const apply = () => {
    if (!editor) return;
    const result = setLink(editor, value);
    if (!result.ok) {
      setError(LINK_REFUSAL_MESSAGES[result.reason]);
      return;
    }
    onClose();
  };
  return (
    <ResponsiveDialog
      open={open}
      onClose={onClose}
      title={state.link ? 'Editar link' : 'Adicionar link'}
      size="sm"
      footer={
        <>
          {state.link ? (
            <Button
              tone="danger"
              variant="ghost"
              onClick={() => {
                if (editor) unsetLink(editor);
                onClose();
              }}
            >
              Remover link
            </Button>
          ) : null}
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={apply}>
            Aplicar link
          </Button>
        </>
      }
    >
      <Field label="Endereço" error={error}>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            value={value}
            inputMode="url"
            placeholder="https://"
            autoFocus
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                apply();
              }
            }}
          />
        )}
      </Field>
    </ResponsiveDialog>
  );
}
