import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { dividerBlock, headingBlock, listBlock, paragraphBlock, quoteBlock, type ArticleBody } from '../article.ts';
import type { BlockId } from '../ids.ts';
import { articleClipboard } from './article-clipboard.ts';

const id = (value: string) => value as BlockId;

const body: ArticleBody = {
  type: 'article',
  title: ' Tilápia ganha vacina contra estreptococose ',
  blocks: [
    paragraphBlock(id('p1'), [
      { text: 'A vacinação ' },
      { text: 'preventiva', marks: ['bold'] },
      { text: ' foi tema do ' },
      { text: 'painel', marks: ['link'], href: 'https://seafoodbrasil.com.br' },
      { text: '.' },
    ]),
    headingBlock(id('h1'), 'O que muda no viveiro'),
    quoteBlock(id('q1'), 'A vacina reduz a mortalidade no verão'),
    quoteBlock(id('q2'), '“Já está nas fazendas”'),
    listBlock(id('l1'), ['Menos antibiótico', 'Mais sobrevivência']),
    dividerBlock(id('d1')),
    paragraphBlock(id('p2'), '   '),
    { id: id('f1'), type: 'figure', slot: { subject: 'Viveiro de tilápia', orientation: 'landscape' } },
  ],
};

describe('article clipboard · "Copiar texto"', () => {
  test('plain text: the title, then one block per paragraph, without images, dividers or empty blocks', () => {
    assert.equal(
      articleClipboard(body).text,
      [
        'Tilápia ganha vacina contra estreptococose',
        'A vacinação preventiva foi tema do painel.',
        'O que muda no viveiro',
        '“A vacina reduz a mortalidade no verão”',
        '“Já está nas fazendas”',
        '- Menos antibiótico\n- Mais sobrevivência',
      ].join('\n\n'),
    );
  });

  test('html: the same blocks, keeping intertítulo, quotation, list, bold and link', () => {
    const { html } = articleClipboard(body);
    assert.equal(
      html,
      [
        '<h1>Tilápia ganha vacina contra estreptococose</h1>',
        '<p>A vacinação <strong>preventiva</strong> foi tema do <a href="https://seafoodbrasil.com.br/">painel</a>.</p>',
        '<h2>O que muda no viveiro</h2>',
        '<blockquote><p>A vacina reduz a mortalidade no verão</p></blockquote>',
        '<blockquote><p>“Já está nas fazendas”</p></blockquote>',
        '<ul>\n  <li>Menos antibiótico</li>\n  <li>Mais sobrevivência</li>\n</ul>',
      ].join('\n'),
    );
    assert.doesNotMatch(html, /<img|<hr|style=|class=/);
  });

  test('markup typed in the text is escaped in the html', () => {
    const { html } = articleClipboard({ type: 'article', title: 'A & B', blocks: [paragraphBlock(id('p'), '<b>x</b>')] });
    assert.equal(html, '<h1>A &amp; B</h1>\n<p>&lt;b&gt;x&lt;/b&gt;</p>');
  });
});

describe('Copiar texto · event formats', () => {
  test('the linha fina follows the title and the event box closes the text', () => {
    const coverage: ArticleBody = { type: 'article', title: 'Hecke estreia no pescado', dek: 'Importadora leva merluza empanada à feira', blocks: [paragraphBlock(id('p1'), [{ text: 'A Hecke apresentou a merluza.' }])] };
    const copied = articleClipboard(coverage, [
      { kind: 'heading', text: 'Seafood Brasil na SSLA 2026' },
      { kind: 'divider', text: '—' },
      { kind: 'service', text: 'Data: de 20 a 22 de outubro' },
    ]);
    assert.equal(copied.text, 'Hecke estreia no pescado\n\nImportadora leva merluza empanada à feira\n\nA Hecke apresentou a merluza.\n\nSeafood Brasil na SSLA 2026\n\n—\n\nData: de 20 a 22 de outubro');
    assert.ok(copied.html.includes('<p><em>Importadora leva merluza empanada à feira</em></p>'));
    assert.ok(copied.html.endsWith('<h3>Seafood Brasil na SSLA 2026</h3>\n<hr>\n<p>Data: de 20 a 22 de outubro</p>'));
  });
});
