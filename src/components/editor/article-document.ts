import { generateHTML, type JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyleKit } from "@tiptap/extension-text-style";
import TextAlign from "@tiptap/extension-text-align";
import Image from "@tiptap/extension-image";
import Highlight from "@tiptap/extension-highlight";

export type ArticleChange = { document: JSONContent; text: string };
export type ArticleVersion = ArticleChange & { id: string; title: string; label: string; time: string };

/** Keep the writing surface and HTML export on the same schema. */
export function articleExtensions(blockViews = false) {
  return [
    StarterKit.configure({
      heading: blockViews ? false : { levels: [2, 3] },
      paragraph: blockViews ? false : {},
      blockquote: blockViews ? false : {},
      bulletList: blockViews ? false : {},
      orderedList: blockViews ? false : {},
      codeBlock: blockViews ? false : {},
      horizontalRule: blockViews ? false : {},
      link: blockViews ? false : { openOnClick: false, defaultProtocol: "https", protocols: ["http", "https", "mailto"] },
    }),
    TextStyleKit,
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    ...(!blockViews ? [Image.configure({ allowBase64: true })] : []),
    Highlight.configure({ multicolor: true }),
  ];
}

export function documentFromText(text: string): JSONContent {
  return {
    type: "doc",
    content: text.split(/\n\s*\n/).map((paragraph) => ({
      type: "paragraph",
      content: paragraph ? paragraph.split("\n").flatMap((line, index) => [
        ...(index ? [{ type: "hardBreak" }] : []),
        ...(line ? [{ type: "text", text: line }] : []),
      ]) : [],
    })),
  };
}

export function safeLink(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
    return ["https:", "http:", "mailto:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

export function safeImageUrl(value: string): string | null {
  const url = safeLink(value);
  return url && /^https?:\/\//.test(url) ? url : null;
}

const escapeHTML = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]!);

/** Browser-only export. Formatting and embedded local images travel with the article. */
export function downloadArticle(title: string, text: string, document?: JSONContent) {
  const body = generateHTML(document ?? documentFromText(text), articleExtensions());
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHTML(title)}</title><style>body{max-width:740px;margin:48px auto;padding:0 24px;font-family:Arial,sans-serif;font-size:17px;line-height:1.8}h1{font-size:34px;line-height:1.2}h2,h3{line-height:1.35}img{max-width:100%;height:auto}blockquote{margin:28px 24px}pre{white-space:pre-wrap}hr{border:0;border-top:1px solid currentColor;margin:32px 0}</style></head><body><article><h1>${escapeHTML(title)}</h1>${body}</article></body></html>`;
  const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  const link = window.document.createElement("a");
  link.href = url;
  link.download = "artigo.html";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
