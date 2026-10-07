"use client";

import { createContext, useContext } from "react";
import type { Editor } from "@tiptap/react";
import { Button, IconButton, Menu } from "@content-ventures/design-system/v3";
import { ArrowDown, ArrowUp, Copy, FileText, Image, LayoutList, Minus, MoreHorizontal, Plus, Sparkles, Trash2 } from "@content-ventures/design-system/v3/icons";
import { moveBlock, type Block, type Intent, type TextRange } from "./studio-model";

export const WritingActions = createContext<{
  ask: (intent: Intent, range?: TextRange) => void;
  image: () => void;
}>({ ask: () => undefined, image: () => undefined });

export function InsertBlockMenu({ editor, position }: { editor: Editor; position: number }) {
  const actions = useContext(WritingActions);
  return <Menu label="Inserir bloco" trigger={(props) => <Button {...props} icon={Plus} size="sm" variant="ghost">Adicionar bloco</Button>}
    sections={[{ items: [{ label: "Continuar com IA", icon: Sparkles, onSelect: () => actions.ask("continue", { from: 0, to: position }) }] }, {
      label: "Adicionar ao artigo", items: [
        { label: "Texto", icon: FileText, content: { type: "paragraph" } },
        { label: "Título de seção", icon: FileText, content: { type: "heading", attrs: { level: 2 } } },
        { label: "Citação", icon: Copy, content: { type: "blockquote", content: [{ type: "paragraph" }] } },
        { label: "Lista com marcadores", icon: LayoutList, content: { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] } },
        { label: "Separador", icon: Minus, content: { type: "horizontalRule" } },
      ].map(({ label, icon, content }) => ({ label, icon, onSelect: () => { editor.chain().focus().insertContentAt(position, content).run(); } })),
    }, { items: [{ label: "Imagem", icon: Image, onSelect: () => { editor.chain().focus().setTextSelection(Math.max(1, position - 1)).run(); actions.image(); } }] }]} />;
}

export function BlockActionsMenu({ editor, block }: { editor: Editor; block: Block }) {
  const actions = useContext(WritingActions);
  return <Menu label={`Ações do bloco ${block.index + 1}`} align="end"
    trigger={(props) => <IconButton {...props} label={`Ações do bloco ${block.index + 1}`} icon={MoreHorizontal} variant="ghost" size="sm" />}
    sections={[{ items: [{ label: "Reescrever com IA", icon: Sparkles, onSelect: () => actions.ask("rewrite", { from: block.from, to: block.to }) }] }, { items: [
      { label: "Mover para cima", icon: ArrowUp, disabled: block.index === 0, onSelect: () => moveBlock(editor, block.index, block.index - 1) },
      { label: "Mover para baixo", icon: ArrowDown, disabled: block.to >= editor.state.doc.content.size, onSelect: () => moveBlock(editor, block.index, block.index + 1) },
      { label: "Duplicar bloco", icon: Copy, onSelect: () => { const node = editor.state.doc.nodeAt(block.from); if (node) editor.chain().focus().insertContentAt(block.to, node.toJSON()).run(); } },
      { label: "Excluir bloco", icon: Trash2, danger: true, onSelect: () => { editor.chain().focus().deleteRange({ from: block.from, to: block.to }).run(); } },
    ]}]} />;
}
