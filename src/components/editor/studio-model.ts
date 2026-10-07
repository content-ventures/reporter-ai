import type { Editor, JSONContent } from "@tiptap/react";
import { TextSelection } from "@tiptap/pm/state";

export type Intent = "rewrite" | "shorten" | "continue" | "list" | "draft";
export type TextRange = { from: number; to: number; inline?: boolean };
export type Block = TextRange & { index: number; type: string; text: string; label: string };
export type Suggestion = {
  id: string; intent: Intent; label: string; original: string; result: string;
  range: TextRange; base: string; mode: "replace" | "insert"; prompt: string;
};
export const intentLabels: Record<Intent, string> = {
  rewrite: "Reescrever trecho", shorten: "Resumir trecho", continue: "Continuar ideia",
  list: "Transformar em tópicos", draft: "Criar rascunho da fonte",
};

export function getBlocks(editor: Editor): Block[] {
  const result: Block[] = [];
  editor.state.doc.forEach((node, from, index) => {
    const type = node.type.name;
    const label = type === "heading" ? "Seção" : type === "blockquote" ? "Citação" : /List$/.test(type) ? "Lista" : type === "image" ? "Imagem" : type === "horizontalRule" ? "Separador" : index === 0 ? "Abertura" : "Parágrafo";
    result.push({ index, from, to: from + node.nodeSize, type, text: node.textContent || node.attrs.alt || "", label });
  });
  return result;
}

export function currentRange(editor: Editor): TextRange {
  const { from, to, empty } = editor.state.selection;
  if (!empty && editor.state.selection instanceof TextSelection) return { from, to, inline: true };
  return getBlocks(editor).find((block) => from >= block.from && from < block.to) ?? { from: 0, to: editor.state.doc.content.size };
}

export function focusBlock(editor: Editor, block: TextRange) {
  const node = editor.state.doc.nodeAt(block.from);
  if (!node) return;
  if (node.isAtom) editor.chain().focus().setNodeSelection(block.from).scrollIntoView().run();
  else editor.chain().focus().setTextSelection(block.from + 1).scrollIntoView().run();
}

export function moveBlock(editor: Editor, fromIndex: number, toIndex: number) {
  const nodes = Array.from({ length: editor.state.doc.childCount }, (_, index) => editor.state.doc.child(index));
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= nodes.length || toIndex >= nodes.length) return;
  const [moved] = nodes.splice(fromIndex, 1);
  nodes.splice(toIndex, 0, moved);
  const tr = editor.state.tr.replaceWith(0, editor.state.doc.content.size, nodes);
  const pos = nodes.slice(0, toIndex).reduce((sum, node) => sum + node.nodeSize, 0);
  tr.setSelection(TextSelection.near(tr.doc.resolve(pos + (moved.isLeaf ? 0 : 1))));
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
}

const sentences = (value: string) => value.match(/[^.!?\n]+[.!?]*/g)?.map((part) => part.trim()).filter(Boolean) ?? [];

/** Explicitly local fixtures: an interaction prototype, never an AI/API result. */
export function simulateSuggestion(editor: Editor, intent: Intent, range: TextRange, transcript: string, prompt: string, tone: string): Suggestion {
  const original = editor.state.doc.textBetween(range.from, range.to, "\n\n");
  const parts = sentences(original);
  const answers = transcript.split(/\n\s*\n/).filter((part) => !/^(Entrevistadora?|Pergunta)\s*:/i.test(part)).map((part) => part.replace(/^[^:\n]{1,40}:\s*/, "").trim()).filter(Boolean);
  let result = original;
  if (intent === "rewrite") {
    if (/inteligência artificial.*redaç/i.test(original)) {
      result = tone === "Didático"
        ? "Na prática, a inteligência artificial ajuda a organizar transcrições e a preparar os primeiros rascunhos. Com essas etapas mais rápidas, a equipe pode dedicar mais tempo à apuração, ao contexto e à revisão do conteúdo."
        : "A inteligência artificial abre espaço para o trabalho editorial ao acelerar a organização de transcrições e a preparação de rascunhos. O tempo recuperado pode ser dedicado à apuração, ao contexto e às perguntas que merecem ser feitas.";
    } else result = parts.length > 1 ? `${parts[parts.length - 1]} ${parts.slice(0, -1).join(" ")}` : `Em síntese, ${original.charAt(0).toLowerCase()}${original.slice(1)}`;
  }
  if (intent === "shorten") result = parts.slice(0, Math.max(1, Math.ceil(parts.length / 2))).join(" ");
  if (intent === "list") result = parts.join("\n");
  if (intent === "continue") result = answers.find((answer) => !original.includes(answer)) || parts[0] || "Desenvolva aqui o próximo ponto da sua história.";
  if (intent === "draft") result = answers.slice(0, 5).join("\n\n") || transcript.trim();
  return { id: crypto.randomUUID(), intent, label: intentLabels[intent], original, result, range,
    base: JSON.stringify(editor.getJSON()), mode: intent === "continue" ? "insert" : "replace", prompt };
}

export function suggestionContent(suggestion: Suggestion): JSONContent[] {
  const blocks = suggestion.result.split(/\n+/).map((text) => text.trim()).filter(Boolean);
  if (suggestion.intent === "list") return [{ type: "bulletList", content: blocks.map((text) => ({ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text }] }] })) }];
  return blocks.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] }));
}
