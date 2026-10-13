import type { Node as PMNode, Schema } from '@tiptap/pm/model';
import type { ArticleBlock, ArticleBody } from '../domain/index.ts';
import { articleToDoc, blockToJSON, docToArticle } from './pm-json.ts';
import type { ArticleToDocOptions, BlockToJSONOptions, DocToArticleOptions, PmNodeJSON } from './pm-json.ts';

/** ProseMirror `Node` versions of the JSON converters (same mapping, schema-checked). */

export function blockNode(schema: Schema, block: ArticleBlock, options?: BlockToJSONOptions): PMNode {
  return schema.nodeFromJSON(blockToJSON(block, options));
}

export function articleDocNode(schema: Schema, body: Pick<ArticleBody, 'blocks' | 'cover' | 'coverSlot'>, options?: ArticleToDocOptions): PMNode {
  return schema.nodeFromJSON(articleToDoc(body, options));
}

/** Current document → domain body. Serialises the whole document: call it on demand, not per keystroke. */
export function docBody(doc: PMNode, options?: DocToArticleOptions): ArticleBody {
  return docToArticle(doc.toJSON() as PmNodeJSON, options);
}

/** One top-level node → domain block (keeps empty blocks). */
export function nodeBlock(node: PMNode, index = 0): ArticleBlock | null {
  return docToArticle({ type: 'doc', content: [node.toJSON() as PmNodeJSON] }, { keepEmpty: true, fallbackId: () => `blk-pending-${index}` }).blocks[0] ?? null;
}
