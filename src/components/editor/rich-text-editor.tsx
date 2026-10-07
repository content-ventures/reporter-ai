"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { EditorContent, useEditor, type JSONContent } from "@tiptap/react";
import { BubbleMenu, type BubbleMenuProps } from "@tiptap/react/menus";
import { ActionBar, Badge, Button, ButtonGroup, Card, Dropzone, Field, FilterBar, FixedFrame, IconButton, Input, LinkButton, MetaList, PageHeader, PageStack, ResizablePanels, ResponsiveDialog, Section, Tabs, Tray, toast } from "@content-ventures/design-system/v3";
import { Bold, Download, Italic, Link2, Maximize, Minimize, PenLine, Check, Sparkles } from "@content-ventures/design-system/v3/icons";
import { EditorToolbar } from "./editor-toolbar";
import { articleExtensions, documentFromText, downloadArticle, safeImageUrl, safeLink, type ArticleChange, type ArticleVersion } from "./article-document";
import { BlockActionsMenu, InsertBlockMenu, WritingActions } from "./block-editor";
import { DocumentOutline } from "./document-outline";
import { WritingAssistant, type AssistantTab, type SourceInfo } from "./writing-assistant";
import { currentRange, getBlocks, simulateSuggestion, suggestionContent, type Intent, type Suggestion, type TextRange } from "./studio-model";
import { articleNodeViews } from "./article-renderer";

const bubbleOptions = { placement: "top" as const, offset: 10 };
const showSelectionMenu: NonNullable<BubbleMenuProps["shouldShow"]> = ({ editor, state }) =>
  editor.isEditable && !state.selection.empty && Boolean(state.doc.textBetween(state.selection.from, state.selection.to).trim());

type Props = {
  title: string;
  text: string;
  document?: JSONContent;
  onTitleChange: (title: string) => void;
  onChange: (change: ArticleChange) => void;
  source: SourceInfo;
  versions: ArticleVersion[];
  onVersionsChange: (versions: ArticleVersion[]) => void;
  focused: boolean;
  onFocusChange: (focused: boolean) => void;
};

async function readImage(file: File) {
  if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) throw new Error("Escolha uma imagem JPG, PNG, WebP ou GIF.");
  if (file.size > 5 * 1024 * 1024) throw new Error("A imagem deve ter até 5 MB.");
  const src = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Não foi possível abrir a imagem."));
    reader.readAsDataURL(file);
  });
  await new Promise<void>((resolve, reject) => {
    const image = new window.Image();
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("O arquivo não contém uma imagem válida."));
    image.src = src;
  });
  return src;
}

/** Article editing behavior composed with public Design System controls and layout. */
export function RichTextEditor({ title, text, document, onTitleChange, onChange, source, versions, onVersionsChange, focused, onFocusChange }: Props) {
  const [view, setView] = useState<"edit" | "preview">("edit");
  const [panelOpen, setPanelOpen] = useState(true);
  const [editingTitle, setEditingTitle] = useState(false);
  const [sideTab, setSideTab] = useState<AssistantTab>("ai");
  const [tone, setTone] = useState("Jornalístico");
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [busy, setBusy] = useState(false);
  const pendingSuggestion = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [initialVersion] = useState<ArticleVersion>(() => ({ id: "initial", label: "Rascunho inicial", title, text, document: document ?? documentFromText(text), time: "Ao abrir" }));
  const history = versions.length ? versions : [initialVersion];
  const [dialog, setDialog] = useState<"link" | "image" | null>(null);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [imageData, setImageData] = useState("");
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [readingFile, setReadingFile] = useState(false);
  const fileReadVersion = useRef(0);
  const [editingImage, setEditingImage] = useState(false);
  const [selectionEmpty, setSelectionEmpty] = useState(true);

  const extensions = useMemo(() => [...articleExtensions(true), ...articleNodeViews()], []);
  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    extensions,
    content: document ?? documentFromText(text),
    editorProps: {
      attributes: { role: "textbox", "aria-label": "Conteúdo do artigo", "aria-multiline": "true", spellcheck: "true", lang: "pt-BR" },
      handlePaste: (view, event) => {
        const file = Array.from(event.clipboardData?.files ?? []).find((file) => file.type.startsWith("image/"));
        if (!file) return false;
        void readImage(file).then((src) => {
          if (!view.isDestroyed) view.dispatch(view.state.tr.replaceSelectionWith(view.state.schema.nodes.image.create({ src, alt: file.name })));
        }).catch((cause: Error) => toast(cause.message, { tone: "error" }));
        return true;
      },
    },
    onUpdate: ({ editor }) => onChange({ document: editor.getJSON(), text: editor.getText({ blockSeparator: "\n\n" }) }),
  }, [extensions]);

  useEffect(() => {
    editor?.setEditable(view === "edit", false);
    editor?.view.dom.setAttribute("aria-readonly", String(view === "preview"));
  }, [editor, view]);
  useEffect(() => {
    if (!focused) return;
    const exit = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !dialog && !event.defaultPrevented) onFocusChange(false);
    };
    window.addEventListener("keydown", exit);
    return () => window.removeEventListener("keydown", exit);
  }, [focused, dialog, onFocusChange]);
  useEffect(() => () => { fileReadVersion.current++; }, []);
  useEffect(() => () => { if (pendingSuggestion.current) clearTimeout(pendingSuggestion.current); }, []);


  function ask(intent: Intent, range?: TextRange, prompt = "") {
    if (!editor) return;
    if (focused) onFocusChange(false);
    if (pendingSuggestion.current) clearTimeout(pendingSuggestion.current);
    const target = intent === "draft" ? { from: 0, to: editor.state.doc.content.size } : range ?? currentRange(editor);
    const next = simulateSuggestion(editor, intent, target, source.transcript, prompt, tone);
    setSideTab("ai"); setPanelOpen(true); setBusy(true); setSuggestion(null);
    pendingSuggestion.current = setTimeout(() => { setSuggestion(next); setBusy(false); pendingSuggestion.current = null; }, 550);
  }

  function discard() {
    if (pendingSuggestion.current) clearTimeout(pendingSuggestion.current);
    pendingSuggestion.current = null; setBusy(false); setSuggestion(null);
  }

  function saveVersion(label = "Versão salva") {
    if (!editor) return;
    onVersionsChange([...history, { id: crypto.randomUUID(), label, title, document: editor.getJSON(), text: editor.getText({ blockSeparator: "\n\n" }), time: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) }]);
  }

  function applySuggestion(mode: "replace" | "insert") {
    if (!editor || !suggestion) return;
    if (JSON.stringify(editor.getJSON()) !== suggestion.base) { toast("O artigo mudou. Gere uma nova sugestão.", { tone: "info" }); return; }
    saveVersion("Antes da sugestão de IA");
    const { range } = suggestion;
    let content = mode === "replace" && range.inline && !["list", "draft"].includes(suggestion.intent)
      ? [{ type: "text", text: suggestion.result }]
      : suggestionContent(suggestion);
    const targetNode = editor.state.doc.nodeAt(range.from);
    if (mode === "replace" && !range.inline && ["rewrite", "shorten"].includes(suggestion.intent) && targetNode) {
      if (targetNode.type.name === "heading" && content.length === 1) content = [{ ...targetNode.toJSON(), content: content[0].content }];
      if (targetNode.type.name === "blockquote") content = [{ type: "blockquote", content }];
    }
    const endOfBlock = getBlocks(editor).find((block) => range.to > block.from && range.to <= block.to)?.to ?? range.to;
    editor.chain().focus().insertContentAt(mode === "insert" ? endOfBlock : range, content).run();
    setSuggestion(null);
    toast("Sugestão aplicada. A versão anterior está no histórico.", { tone: "success" });
  }

  function restoreVersion(version: ArticleVersion) {
    if (!editor) return;
    saveVersion("Antes de restaurar");
    editor.commands.setContent(version.document);
    onTitleChange(version.title);
    discard(); toast("Versão restaurada", { tone: "success" });
  }

  function openDialog(kind: "link" | "image") {
    if (!editor) return;
    fileReadVersion.current++;
    setError(""); setImageData(""); setFileName(""); setReadingFile(false);
    setSelectionEmpty(editor.state.selection.empty);
    if (kind === "link") {
      setUrl(editor.getAttributes("link").href ?? "");
      setLabel(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, " "));
    } else {
      const active = editor.isActive("image");
      setEditingImage(active);
      const attrs = editor.getAttributes("image");
      setUrl(active && !attrs.src?.startsWith("data:") ? attrs.src : "");
      setImageData(active && attrs.src?.startsWith("data:") ? attrs.src : "");
      setLabel(active ? attrs.alt ?? "" : "");
    }
    setDialog(kind);
  }

  function closeDialog() {
    fileReadVersion.current++;
    setDialog(null);
  }

  function applyLink() {
    if (!editor) return;
    const href = safeLink(url);
    if (!href) { setError("Informe um endereço válido, como https://site.com."); return; }
    const chain = editor.chain().focus().extendMarkRange("link");
    if (selectionEmpty && !editor.isActive("link")) {
      chain.insertContent({ type: "text", text: label.trim() || href, marks: [{ type: "link", attrs: { href, target: "_blank", rel: "noopener noreferrer" } }] }).run();
    } else chain.setLink({ href }).run();
    closeDialog();
  }

  function applyImage() {
    if (!editor) return;
    const src = imageData || safeImageUrl(url);
    if (!src) { setError("Selecione uma imagem ou informe um endereço HTTP ou HTTPS."); return; }
    const chain = editor.chain().focus();
    if (editingImage) chain.updateAttributes("image", { src, alt: label.trim() }).run();
    else chain.setImage({ src, alt: label.trim() }).run();
    closeDialog();
  }

  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const range = editor ? currentRange(editor) : null;
  const selectedText = editor && range ? editor.state.doc.textBetween(range.from, range.to, "\n\n") : "";
  const activeBlock = editor && range ? getBlocks(editor).find((block) => range.from >= block.from && range.from < block.to) : null;
  const readonly = view === "preview";
  const documentCanvas = <Tray title={readonly ? "Prévia do artigo" : "Artigo em edição"} meta={readonly ? "Leitura" : "Rascunho salvo agora"}
    actions={!readonly && editor ? <>
      <InsertBlockMenu editor={editor} position={activeBlock?.to ?? editor.state.doc.content.size} />
      {activeBlock && <BlockActionsMenu editor={editor} block={activeBlock} />}
    </> : undefined}>
    <Card padding="lg" as="article" aria-label="Documento do artigo">
      <PageStack>
        <PageHeader title={editingTitle && !readonly ? <Input aria-label="Título do artigo" value={title} onChange={(event) => onTitleChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === "Escape") setEditingTitle(false); }} /> : title || "Artigo sem título"}
          titleAs="h2" meta={[`${Math.max(1, Math.ceil(words / 200))} min de leitura`, <LinkButton key="source" tone="quiet" onClick={() => { onFocusChange(false); setView("edit"); setPanelOpen(true); setSideTab("source"); }}>Consultar fonte</LinkButton>]}
          more={!readonly && <IconButton label={editingTitle ? "Concluir edição do título" : "Editar título"} icon={editingTitle ? Check : PenLine} variant="ghost" size="sm" onClick={() => setEditingTitle(!editingTitle)} />}
          toolbar={!readonly && editor ? <EditorToolbar editor={editor} onLink={() => openDialog("link")} onImage={() => openDialog("image")} /> : undefined} />
        {!editor && <MetaList items={["Preparando a área de escrita…"]} />}
        <EditorContent editor={editor} onClick={(event) => {
          if (view !== "preview" || !(event.target instanceof Element)) return;
          const link = event.target.closest("a");
          const href = link && safeLink(link.getAttribute("href") ?? "");
          if (href) { event.preventDefault(); window.open(href, "_blank", "noopener,noreferrer"); }
        }} />
        {editor && !readonly && <Section title="Próximo bloco" action={<Button variant="ghost" size="sm" icon={Sparkles} onClick={() => ask("continue")}>Continuar com IA</Button>} />}
      </PageStack>
    </Card>
  </Tray>;
  return <WritingActions.Provider value={{ ask, image: () => openDialog("image") }}>
    <FixedFrame height="max(640px, calc(100dvh - 190px))" mainLabel="Estúdio de escrita" asideLabel="Painel editorial"
      header={<FilterBar key="writing-navigation" filters={false} filtersOpen={false} onFiltersOpenChange={() => undefined} tabs={<Tabs label="Modo do artigo" size="sm" value={view} onChange={setView} items={[
        { value: "edit", label: "Escrita" }, { value: "preview", label: "Prévia" },
      ]} />} actions={<>
        <IconButton label="Baixar artigo formatado (HTML)" icon={Download} variant="ghost" size="sm" onClick={() => downloadArticle(title, text, editor?.getJSON() ?? document)} />
        <IconButton label={focused ? "Sair do foco" : "Modo foco"} icon={focused ? Minimize : Maximize} aria-pressed={focused} variant="ghost" size="sm" onClick={() => onFocusChange(!focused)} />
        <Button size="sm" variant="ghost" icon={Sparkles} aria-pressed={panelOpen && !focused && !readonly} onClick={() => { if (focused) onFocusChange(false); if (readonly) setView("edit"); setPanelOpen(!panelOpen || focused || readonly); }}>Assistente</Button>
      </>} />}
      aside={editor && panelOpen && !focused && !readonly ? <WritingAssistant tab={sideTab} onTab={setSideTab} onClose={() => setPanelOpen(false)}
        selectedText={suggestion?.original ?? selectedText} selectedLabel={suggestion?.intent === "draft" ? "Artigo completo" : range?.inline ? "Trecho selecionado" : activeBlock?.label ?? "Artigo"}
        tone={tone} onTone={setTone} suggestion={suggestion} busy={busy} stale={Boolean(suggestion && suggestion.base !== JSON.stringify(editor.getJSON()))}
        onGenerate={(intent, prompt) => ask(intent, undefined, prompt)} onEditSuggestion={(result) => setSuggestion((previous) => previous && ({ ...previous, result }))}
        onApply={applySuggestion} onDiscard={discard} source={source} versions={history} onSave={() => { saveVersion(); toast("Versão salva nesta sessão", { tone: "success" }); }} onRestore={restoreVersion}
        onQuote={(quote) => { editor.chain().focus().insertContentAt(activeBlock?.to ?? editor.state.doc.content.size, { type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: quote }] }] }).run(); toast("Citação inserida no artigo", { tone: "success" }); }} /> : undefined}
      footer={<ActionBar position="static" status="saved" start={<Badge tone="gray" variant="text">Edição por blocos</Badge>}>
        <MetaList size="xs" items={[`${words.toLocaleString("pt-BR")} palavras`, `${editor ? getBlocks(editor).length : 0} blocos`]} />
        {editor && !readonly && <Button variant="primary" size="sm" icon={Sparkles} onClick={() => ask("continue")}>Continuar com IA</Button>}
      </ActionBar>}>
      {editor && !readonly ? <ResizablePanels storageKey="reporter-ai-article-outline" defaultSize={216} min={200} max={300} stackBelow={420}
        label="Largura do roteiro do artigo" showLabel="Mostrar roteiro" left={<DocumentOutline editor={editor} onAssistant={() => { setPanelOpen(true); setSideTab("ai"); }} />}
        right={documentCanvas} /> : documentCanvas}
    </FixedFrame>
    {editor && <BubbleMenu editor={editor} options={bubbleOptions} shouldShow={showSelectionMenu}>
      <Card padding="sm"><ButtonGroup label="Ações sobre a seleção" size="sm">
        <Button variant="ghost" size="sm" icon={Sparkles} onMouseDown={(event) => event.preventDefault()} onClick={() => ask("rewrite")}>Pedir à IA</Button>
        <IconButton label="Negrito na seleção" icon={Bold} variant="ghost" size="sm" aria-pressed={editor.isActive("bold")} onMouseDown={(event) => event.preventDefault()} onClick={() => editor.chain().focus().toggleBold().run()} />
        <IconButton label="Itálico na seleção" icon={Italic} variant="ghost" size="sm" aria-pressed={editor.isActive("italic")} onMouseDown={(event) => event.preventDefault()} onClick={() => editor.chain().focus().toggleItalic().run()} />
        <IconButton label="Link na seleção" icon={Link2} variant="ghost" size="sm" onClick={() => openDialog("link")} />
      </ButtonGroup></Card>
    </BubbleMenu>}

    <ResponsiveDialog open={dialog === "link"} onClose={closeDialog} title={editor?.isActive("link") ? "Editar link" : "Inserir link"} size="sm"
      footer={<>
        {editor?.isActive("link") && <Button variant="ghost" onClick={() => { editor.chain().focus().extendMarkRange("link").unsetLink().run(); closeDialog(); }}>Remover link</Button>}
        <Button onClick={closeDialog}>Cancelar</Button><Button variant="primary" onClick={applyLink}>Aplicar link</Button>
      </>}>
      <PageStack>
        <Field label="Endereço" error={error || undefined}>{({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} aria-invalid={invalid}
          value={url} placeholder="https://" onChange={(event) => { setUrl(event.target.value); setError(""); }} onKeyDown={(event) => { if (event.key === "Enter") applyLink(); }} />}</Field>
        {selectionEmpty && !editor?.isActive("link") && <Field label="Texto do link" optional>{({ id }) => <Input id={id} value={label} onChange={(event) => setLabel(event.target.value)} />}</Field>}
      </PageStack>
    </ResponsiveDialog>
    <ResponsiveDialog open={dialog === "image"} onClose={closeDialog} title={editingImage ? "Editar imagem" : "Inserir imagem"} size="sm"
      footer={<>
        {editingImage && <Button variant="ghost" onClick={() => { editor?.chain().focus().deleteSelection().run(); closeDialog(); }}>Remover imagem</Button>}
        <Button onClick={closeDialog}>Cancelar</Button><Button variant="primary" loading={readingFile} disabled={readingFile || Boolean(error)} onClick={applyImage}>{editingImage ? "Aplicar" : "Inserir imagem"}</Button>
      </>}>
      <PageStack>
        <Dropzone title="Escolher imagem" spec="JPG, PNG, WebP ou GIF · até 5 MB" accept="image/jpeg,image/png,image/webp,image/gif" maxSize={5 * 1024 * 1024}
          disabled={readingFile} invalid={Boolean(error)} error={error} onFiles={async (files, rejected) => {
            if (rejected.length) { setError(rejected[0].reason === "size" ? "A imagem deve ter até 5 MB." : "Escolha uma imagem JPG, PNG, WebP ou GIF."); return; }
            const file = files[0];
            if (!file) return;
            const version = ++fileReadVersion.current;
            setReadingFile(true); setError(""); setImageData(""); setFileName(""); setUrl("");
            try {
              const data = await readImage(file);
              if (version !== fileReadVersion.current) return;
              setImageData(data); setUrl(""); setFileName(file.name);
            } catch (cause) { if (version === fileReadVersion.current) setError((cause as Error).message); }
            finally { if (version === fileReadVersion.current) setReadingFile(false); }
          }} />
        {imageData && <MetaList size="sm" items={[fileName || "Imagem incorporada ao artigo"]} />}
        <Field label="Ou usar endereço da imagem">{({ id }) => <Input id={id} value={url} placeholder="https://site.com/imagem.jpg" onChange={(event) => {
          fileReadVersion.current++; setReadingFile(false); setUrl(event.target.value); setImageData(""); setFileName(""); setError("");
        }} />}</Field>
        <Field label="Descrição da imagem" hint="Descreva o que a imagem mostra para quem usa leitor de tela.">{({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} value={label} onChange={(event) => setLabel(event.target.value)} />}</Field>
      </PageStack>
    </ResponsiveDialog>
  </WritingActions.Provider>;
}
