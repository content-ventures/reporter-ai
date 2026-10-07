"use client";

import { MarkViewContent, NodeViewContent, NodeViewWrapper, ReactMarkViewRenderer, ReactNodeViewRenderer, type MarkViewProps, type NodeViewProps } from "@tiptap/react";
import Paragraph from "@tiptap/extension-paragraph";
import Heading from "@tiptap/extension-heading";
import Blockquote from "@tiptap/extension-blockquote";
import { BulletList, OrderedList } from "@tiptap/extension-list";
import CodeBlock from "@tiptap/extension-code-block";
import HorizontalRule from "@tiptap/extension-horizontal-rule";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { Card, CardHeader, Divider, MediaFrame, ScrollArea, Section, TextLink } from "@content-ventures/design-system/v3";

/** Bridge document nodes to public DS components; no product styling is defined here. */
function TextBlock({ node, editor, getPos }: NodeViewProps) {
  const position = getPos();
  const topLevel = typeof position === "number" && editor.state.doc.resolve(position).depth === 0;
  const content = <NodeViewContent />;
  if (node.type.name === "codeBlock") return <NodeViewWrapper><Section><ScrollArea label="Bloco de código" orientation="horizontal">{content}</ScrollArea></Section></NodeViewWrapper>;
  if (node.type.name === "heading") {
    const title = <NodeViewContent<"span"> as="span" />;
    return <NodeViewWrapper><Section>
      <CardHeader title={title} titleAs={node.attrs.level === 2 ? "h2" : "h3"} size={node.attrs.level === 2 ? "md" : "sm"} />
    </Section></NodeViewWrapper>;
  }
  return <NodeViewWrapper>{topLevel && position !== 0 ? <Section>{content}</Section> : content}</NodeViewWrapper>;
}

function ImageBlock({ node, selected }: NodeViewProps) {
  return <NodeViewWrapper data-drag-handle tabIndex={selected ? 0 : undefined}>
    <Section><Card padding="none" selected={selected}><MediaFrame src={node.attrs.src} alt={node.attrs.alt || "Imagem do artigo"} fit="contain" ratio="4/3" /></Card></Section>
  </NodeViewWrapper>;
}

function ArticleLink({ mark }: MarkViewProps) {
  return <TextLink href={mark.attrs.href} target={mark.attrs.target} rel={mark.attrs.rel}><MarkViewContent /></TextLink>;
}

function DividerBlock() {
  return <NodeViewWrapper><Divider spacing="md" /></NodeViewWrapper>;
}

const textView = (contentDOMElementTag: string) => () => ReactNodeViewRenderer(TextBlock, {
  contentDOMElementTag,
  // Preserve Tiptap's serialized document formatting (e.g. user-selected alignment).
  // This is document data; all interface typography and spacing come from the DS.
  attrs: ({ HTMLAttributes }) => ({ style: HTMLAttributes.style ?? "" }),
});

export function articleNodeViews() {
  return [
    Paragraph.extend({ addNodeView: textView("p") }),
    Heading.extend({ addNodeView: textView("span") }).configure({ levels: [2, 3] }),
    Blockquote.extend({ addNodeView: textView("div") }),
    BulletList.extend({ addNodeView: textView("ul") }),
    OrderedList.extend({ addNodeView: textView("ol") }),
    CodeBlock.extend({ addNodeView: textView("pre") }),
    HorizontalRule.extend({ addNodeView: () => ReactNodeViewRenderer(DividerBlock) }),
    Link.extend({ addMarkView: () => ReactMarkViewRenderer(ArticleLink) }).configure({ openOnClick: false, defaultProtocol: "https", protocols: ["http", "https", "mailto"] }),
    Image.extend({ addNodeView: () => ReactNodeViewRenderer(ImageBlock) }).configure({ allowBase64: true }),
  ];
}
