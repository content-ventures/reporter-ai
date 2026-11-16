import assert from 'node:assert/strict';
import { test } from 'node:test';
import { articleCharacters, articleHash, blockText, replaceTextRange, type ArticleBody } from '../domain/article.ts';
import { r1ArticleIssue } from '../domain/article-policy.ts';
import { articleClipboard } from '../domain/text/article-clipboard.ts';
import { articleToMarkdown } from '../adapters/local/export/markdown.ts';
import { articleSchema } from './extensions.ts';
import { articleDocNode, docBody } from './nodes.ts';
import { blockTextOf } from './ranges.ts';

const body: ArticleBody = { type: 'article', title: 'Dados fornecidos', blocks: [{ id: 'data', type: 'table',
  rows: [[[ { text: 'Aspecto' } ], [{ text: 'Observação' }]], [[{ text: 'Manejo' }], [{ text: 'Dado confirmado <sem HTML>' }]]] }] };

test('tables keep editable cells, headers and content through the actual article schema and exports', () => {
  const document = articleDocNode(articleSchema(), body); document.check();
  assert.deepEqual(docBody(document, { title: body.title }), body);
  assert.equal(blockTextOf(document.firstChild!), blockText(body.blocks[0]));
  const clipboard = articleClipboard(body);
  assert.match(clipboard.html, /<th>Aspecto<\/th>/);
  assert.match(clipboard.html, /Dado confirmado &lt;sem HTML&gt;/);
  assert.match(articleToMarkdown(body), /\| Aspecto \| Observação \|/);
  assert.equal(articleCharacters(body), 51, 'spaces and cell separators count; the row break does not');
  const edited = replaceTextRange(body, { blockId: 'data', from: 0, to: 7 }, 'Tema');
  assert.equal(edited.ok, true);
  if (edited.ok) assert.notEqual(articleHash(body), articleHash(edited.value));
});

test('a table never bypasses literal-quote verification or the character ceiling', () => {
  const quoted: ArticleBody = { ...body, blocks: [{ id: 'data', type: 'table', rows: [[[ { text: '“Declaração inventada.”' } ], [{ text: 'Sem evidência' }]]] }] };
  assert.equal(r1ArticleIssue(quoted, [], { maxChars: 2000 }), 'UNSUPPORTED_ARTICLE_QUOTE');
  assert.equal(r1ArticleIssue(body, [], { maxChars: 10 }), 'ARTICLE_SIZE_EXCEEDED');
});
