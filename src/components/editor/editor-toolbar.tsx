"use client";

import type { Editor } from "@tiptap/react";
import { Button, Divider, IconButton, Menu, Section } from "@content-ventures/design-system/v3";
import { Bold, Italic, Underline, RotateCcw, RotateCw, Link2, Image, Minus, Palette, ChevronDown } from "@content-ventures/design-system/v3/icons";

const colors = [
  ["ink", "Padrão"], ["muted", "Cinza"], ["b-700", "Azul"], ["teal-ink", "Petróleo"],
  ["green-ink", "Verde"], ["amber-ink", "Ocre"], ["red-ink", "Vermelho"], ["violet-ink", "Violeta"],
] as const;

export function EditorToolbar({ editor, onLink, onImage }: { editor: Editor; onLink: () => void; onImage: () => void }) {
  const preserveSelection = (event: React.MouseEvent) => event.preventDefault();
  const textStyle = editor.getAttributes("textStyle");
  const block = editor.isActive("heading", { level: 2 }) ? "h2" : editor.isActive("heading", { level: 3 }) ? "h3" : "p";
  const alignment = editor.getAttributes("paragraph").textAlign ?? editor.getAttributes("heading").textAlign ?? "left";
  return <Section variant="band" title="Texto">
    <IconButton label="Desfazer (⌘/Ctrl Z)" icon={RotateCcw} variant="ghost" size="sm" disabled={!editor.can().undo()} onMouseDown={preserveSelection} onClick={() => editor.chain().focus().undo().run()} />
    <IconButton label="Refazer (⌘/Ctrl Shift Z)" icon={RotateCw} variant="ghost" size="sm" disabled={!editor.can().redo()} onMouseDown={preserveSelection} onClick={() => editor.chain().focus().redo().run()} />
    <Divider orientation="vertical" />
    <Menu label="Estilo do parágrafo" trigger={(props) => <Button {...props} variant="ghost" size="sm" trailingIcon={ChevronDown}>{block === "h2" ? "Título de seção" : block === "h3" ? "Subtítulo" : "Texto normal"}</Button>}
      sections={[{ items: [
        { label: "Texto normal", checked: block === "p", onSelect: () => { editor.chain().focus().setParagraph().run(); } },
        { label: "Título de seção", checked: block === "h2", onSelect: () => { editor.chain().focus().setHeading({ level: 2 }).run(); } },
        { label: "Subtítulo", checked: block === "h3", onSelect: () => { editor.chain().focus().setHeading({ level: 3 }).run(); } },
      ] }]} />
    <Menu label="Fonte do texto" trigger={(props) => <Button {...props} variant="ghost" size="sm" trailingIcon={ChevronDown}>{textStyle.fontFamily || "Inter"}</Button>}
      sections={[{ items: ["Inter", "Georgia", "Arial", "Courier New"].map((font) => ({ label: font, checked: (textStyle.fontFamily || "Inter") === font, onSelect: () => {
        if (font === "Inter") editor.chain().focus().unsetFontFamily().run(); else editor.chain().focus().setFontFamily(font).run();
      } })) }]} />
    <Menu label="Tamanho do texto" trigger={(props) => <Button {...props} variant="ghost" size="sm" trailingIcon={ChevronDown}>{textStyle.fontSize || "Auto"}</Button>}
      sections={[{ items: [
        { label: "Auto", checked: !textStyle.fontSize, onSelect: () => { editor.chain().focus().unsetFontSize().run(); } },
        ...[14, 16, 18, 20, 24, 28, 32].map((size) => ({ label: `${size} px`, checked: textStyle.fontSize === `${size}px`, onSelect: () => { editor.chain().focus().setFontSize(`${size}px`).run(); } })),
      ] }]} />
    <Divider orientation="vertical" />
    <IconButton label="Negrito (⌘/Ctrl B)" icon={Bold} variant="ghost" size="sm" aria-pressed={editor.isActive("bold")} onMouseDown={preserveSelection} onClick={() => editor.chain().focus().toggleBold().run()} />
    <IconButton label="Itálico (⌘/Ctrl I)" icon={Italic} variant="ghost" size="sm" aria-pressed={editor.isActive("italic")} onMouseDown={preserveSelection} onClick={() => editor.chain().focus().toggleItalic().run()} />
    <IconButton label="Sublinhado (⌘/Ctrl U)" icon={Underline} variant="ghost" size="sm" aria-pressed={editor.isActive("underline")} onMouseDown={preserveSelection} onClick={() => editor.chain().focus().toggleUnderline().run()} />
    <Button variant="ghost" size="sm" aria-pressed={editor.isActive("strike")} onMouseDown={preserveSelection} onClick={() => editor.chain().focus().toggleStrike().run()}>Tachado</Button>
    <Menu label="Cor do texto" trigger={(props) => <IconButton {...props} label="Cor do texto" icon={Palette} variant="ghost" size="sm" />}
      sections={[{ items: colors.map(([token, label]) => ({ label, onSelect: () => {
        if (token === "ink") editor.chain().focus().unsetColor().run();
        else editor.chain().focus().setColor(getComputedStyle(editor.view.dom).getPropertyValue(`--${token}`).trim()).run();
      } })) }]} />
    <Button variant="ghost" size="sm" aria-pressed={editor.isActive("highlight")} onMouseDown={preserveSelection} onClick={() => editor.chain().focus().toggleHighlight({ color: getComputedStyle(editor.view.dom).getPropertyValue("--amber-line").trim() }).run()}>Marca-texto</Button>
    <Divider orientation="vertical" />
    <Menu label="Alinhamento do texto" trigger={(props) => <Button {...props} variant="ghost" size="sm" trailingIcon={ChevronDown}>Alinhar</Button>}
      sections={[{ items: [["left", "À esquerda"], ["center", "Centralizado"], ["right", "À direita"], ["justify", "Justificado"]].map(([value, label]) => ({ label, checked: alignment === value, onSelect: () => { editor.chain().focus().setTextAlign(value).run(); } })) }]} />
    <Button variant="ghost" size="sm" aria-pressed={editor.isActive("bulletList")} onMouseDown={preserveSelection} onClick={() => editor.chain().focus().toggleBulletList().run()}>Lista</Button>
    <Button variant="ghost" size="sm" aria-pressed={editor.isActive("orderedList")} onMouseDown={preserveSelection} onClick={() => editor.chain().focus().toggleOrderedList().run()}>Lista numerada</Button>
    <Button variant="ghost" size="sm" aria-pressed={editor.isActive("blockquote")} onMouseDown={preserveSelection} onClick={() => editor.chain().focus().toggleBlockquote().run()}>Citação</Button>
    <Divider orientation="vertical" />
    <IconButton label="Inserir ou editar link" icon={Link2} variant="ghost" size="sm" aria-pressed={editor.isActive("link")} onClick={onLink} />
    <Button variant="ghost" size="sm" icon={Image} onClick={onImage}>Imagem</Button>
    <IconButton label="Inserir separador" icon={Minus} variant="ghost" size="sm" onMouseDown={preserveSelection} onClick={() => editor.chain().focus().setHorizontalRule().run()} />
    <Button variant="ghost" size="sm" onMouseDown={preserveSelection} onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().unsetTextAlign().run()}>Limpar formato</Button>
  </Section>;
}
