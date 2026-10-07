"use client";

import type { Editor } from "@tiptap/react";
import { Button, List, ListItem, Panel, Section } from "@content-ventures/design-system/v3";
import { FileText, LayoutList, Sparkles } from "@content-ventures/design-system/v3/icons";
import { focusBlock, getBlocks, moveBlock } from "./studio-model";
import { BlockActionsMenu, InsertBlockMenu } from "./block-editor";

export function DocumentOutline({ editor, onAssistant }: { editor: Editor; onAssistant: () => void }) {
  const blocks = getBlocks(editor);
  const selected = blocks.find((block) => editor.state.selection.from >= block.from && editor.state.selection.from < block.to)?.index ?? 0;
  return <Panel label="Roteiro do artigo">
    <Section title="Roteiro" meta={`${blocks.length} blocos`}>
      <List label="Roteiro do artigo" framed={false} dividers onReorder={(from, to) => moveBlock(editor, from, to)}>
        {blocks.map((block) => <ListItem key={block.index} draggable density="sm" title={block.label}
          description={block.text || (block.type === "horizontalRule" ? "Linha divisória" : "Bloco vazio")}
          leading={block.type.endsWith("List") ? <LayoutList size={16} /> : <FileText size={16} />} selected={selected === block.index}
          onClick={() => focusBlock(editor, block)} actions={<BlockActionsMenu editor={editor} block={block} />} />)}
      </List>
    </Section>
    <Section title="Construir artigo">
      <InsertBlockMenu editor={editor} position={editor.state.doc.content.size} />
      <Button size="sm" variant="ghost" icon={Sparkles} onClick={onAssistant}>Escrever com IA</Button>
    </Section>
  </Panel>;
}
