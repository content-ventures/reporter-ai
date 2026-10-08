import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { DOMOutputSpec, Node as PMNode, TagParseRule } from '@tiptap/pm/model';
import { figureBlock, headingBlock, paragraphBlock, quoteBlock } from '../domain/index.ts';
import { ArticleKeymap, articleExtensions, articleSchema, DEFAULT_PLACEHOLDERS } from './extensions.ts';
import { FIGURE_MAX_HEIGHT, figureDisplaySize } from './figures.ts';
import { blockNode } from './nodes.ts';
import { REF_A } from './test-support.ts';

type FakeElement = {
  nodeName: string;
  attrs: Record<string, string>;
  children: FakeElement[];
  text?: string;
  getAttribute: (name: string) => string | null;
  querySelector: (selector: string) => FakeElement | null;
  textContent: string;
};

/** Minimal element double for parse rules (no DOM in node --test). */
function element(nodeName: string, attrs: Record<string, string> = {}, children: FakeElement[] = [], text?: string): FakeElement {
  const self: FakeElement = {
    nodeName: nodeName.toUpperCase(),
    attrs,
    children,
    text,
    getAttribute: (name) => attrs[name] ?? null,
    querySelector: (selector) => {
      const visit = (node: FakeElement): FakeElement | null => {
        for (const child of node.children) {
          if (child.nodeName === selector.toUpperCase()) return child;
          const found = visit(child);
          if (found) return found;
        }
        return null;
      };
      return visit(self);
    },
    get textContent() {
      return (text ?? '') + children.map((child) => child.textContent).join('');
    },
  };
  return self;
}

function figureRule(tag: string): TagParseRule {
  const rule = ((schema.nodes.figure.spec.parseDOM ?? []) as TagParseRule[]).find((candidate) => candidate.tag === tag);
  assert.ok(rule?.getAttrs, tag);
  return rule;
}

function parse(tag: string, el: FakeElement): Record<string, unknown> | false | null | undefined {
  return figureRule(tag).getAttrs?.(el as unknown as HTMLElement);
}

const schema = articleSchema();

function render(node: PMNode): DOMOutputSpec {
  const toDOM = node.type.spec.toDOM;
  assert.ok(toDOM);
  return toDOM(node);
}

describe('article schema', () => {
  test('holds exactly the article capabilities: figures, but no code, highlight, text style, alignment or inline image', () => {
    assert.deepEqual(Object.keys(schema.nodes).sort(), [
      'blockquote',
      'bulletList',
      'doc',
      'figure',
      'hardBreak',
      'heading',
      'horizontalRule',
      'listItem',
      'orderedList',
      'paragraph',
      'text',
    ]);
    assert.deepEqual(Object.keys(schema.marks).sort(), ['bold', 'italic', 'link', 'strike', 'underline']);
    for (const banned of ['codeBlock', 'image']) assert.equal(schema.nodes[banned], undefined);
    for (const banned of ['code', 'highlight', 'textStyle']) assert.equal(schema.marks[banned], undefined);
    assert.equal(schema.nodes.paragraph.spec.attrs?.textAlign, undefined);
  });

  test('a quote is a textblock and a list item holds one paragraph (no nesting)', () => {
    assert.equal(schema.nodes.blockquote.isTextblock, true);
    assert.equal(schema.nodes.listItem.spec.content, 'paragraph');
    assert.equal(schema.nodes.listItem.contentMatch.matchType(schema.nodes.bulletList), null);
  });

  test('a figure is a selectable atom that is not dragged or typed into', () => {
    const figure = schema.nodes.figure;
    assert.equal(figure.isAtom, true);
    assert.equal(figure.isLeaf, true);
    assert.equal(figure.isBlock, true);
    assert.equal(figure.spec.selectable, true);
    assert.equal(figure.spec.draggable, false);
    assert.deepEqual(Object.keys(figure.spec.attrs ?? {}).sort(), ['ai', 'alt', 'assetId', 'blockId', 'caption', 'credit', 'height', 'sourceRefs', 'src', 'width']);
  });

  test('the cover is a document attribute, not a node', () => {
    assert.ok('cover' in (schema.nodes.doc.spec.attrs ?? {}));
    assert.equal(schema.nodes.cover, undefined);
  });

  test('only top-level block types carry the block attributes', () => {
    for (const name of ['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'horizontalRule', 'figure']) {
      assert.deepEqual(['blockId', 'sourceRefs', 'ai'].map((attr) => attr in (schema.nodes[name].spec.attrs ?? {})), [true, true, true], name);
    }
    assert.equal('blockId' in (schema.nodes.listItem.spec.attrs ?? {}), false);
  });

  test('renders plain HTML with data-block-id; source refs and AI state stay out of the DOM', () => {
    const paragraph = blockNode(schema, paragraphBlock('p1', 'Texto', { ai: 'unreviewed', sourceRefs: [REF_A] }));
    assert.deepEqual(render(paragraph), ['p', { 'data-block-id': 'p1' }, 0]);
    assert.deepEqual(render(blockNode(schema, headingBlock('h1', 'T', 3))), ['h3', { 'data-block-id': 'h1' }, 0]);
    assert.deepEqual(render(blockNode(schema, quoteBlock('q1', 'Fala'))), ['blockquote', { 'data-block-id': 'q1' }, ['p', 0]]);
  });

  test('parses a pasted multi-paragraph quote into the quote, and keeps ids from data-block-id', () => {
    const rules = (schema.nodes.blockquote.spec.parseDOM ?? []) as TagParseRule[];
    assert.ok(rules.some((rule) => rule.tag === 'blockquote'));
    assert.ok(rules.some((rule) => rule.tag === 'p' && rule.context === 'blockquote/' && rule.skip === true));
    const paragraphRule = (schema.nodes.paragraph.spec.parseDOM ?? [])[0] as TagParseRule;
    assert.ok(paragraphRule.getAttrs);
    const element = { getAttribute: (name: string) => (name === 'data-block-id' ? 'blk-copied' : null) } as unknown as HTMLElement;
    assert.deepEqual(paragraphRule.getAttrs(element), { blockId: 'blk-copied' });
  });

  test('refuses unsafe links when parsing pasted HTML', () => {
    const rule = (schema.marks.link.spec.parseDOM ?? []).find((candidate) => 'tag' in candidate && candidate.tag?.startsWith('a')) as TagParseRule | undefined;
    assert.ok(rule?.getAttrs);
    const element = (href: string) => ({ getAttribute: (name: string) => (name === 'href' ? href : null) }) as unknown as HTMLElement;
    assert.equal(rule.getAttrs(element('javascript:alert(1)')), false);
    assert.notEqual(rule.getAttrs(element('https://example.com')), false);
  });
});

describe('figure HTML', () => {
  const figure = (image: Parameters<typeof figureBlock>[1], display: Record<string, unknown> = {}) => {
    const node = blockNode(schema, figureBlock('f1', image));
    return render(schema.nodes.figure.create({ ...node.attrs, ...display }));
  };

  test('figure[data-block-id] > img + figcaption with the caption, a dash and the credit line in cite', () => {
    assert.deepEqual(figure({ assetId: 'ast-1', alt: 'Ana na bancada', caption: 'Ana corta o couro' }, { src: 'blob:http://localhost/1', credit: 'Ana Prado/Ateliê Sul' }), [
      'figure',
      { 'data-block-id': 'f1', 'data-asset-id': 'ast-1' },
      ['img', { alt: 'Ana na bancada', draggable: 'false', src: 'blob:http://localhost/1' }],
      ['figcaption', 'Ana corta o couro — ', ['cite', 'Foto: Ana Prado/Ateliê Sul']],
    ]);
  });

  test('leaves out empty parts and keeps a credit that already names its kind', () => {
    assert.deepEqual(figure({ assetId: 'ast-1' }, { src: 'https://example.com/a.jpg' }), [
      'figure',
      { 'data-block-id': 'f1', 'data-asset-id': 'ast-1' },
      ['img', { alt: '', draggable: 'false', src: 'https://example.com/a.jpg' }],
    ]);
    const credited = figure({ assetId: 'ast-1' }, { src: 'https://example.com/a.jpg', credit: 'Ilustração: Bia' }) as readonly unknown[];
    assert.deepEqual(credited[3], ['figcaption', ['cite', 'Ilustração: Bia']]);
    const captioned = figure({ assetId: 'ast-1', caption: 'Só legenda' }, { src: 'https://example.com/a.jpg' }) as readonly unknown[];
    assert.deepEqual(captioned[3], ['figcaption', 'Só legenda']);
  });

  test('without a file the img has no src and carries data-missing; unsafe addresses are not shown', () => {
    assert.deepEqual((figure({ assetId: 'ast-1', alt: 'Foto' }) as readonly unknown[])[2], ['img', { alt: 'Foto', draggable: 'false', 'data-missing': '' }]);
    assert.deepEqual((figure({ assetId: 'ast-1' }, { src: 'javascript:alert(1)' }) as readonly unknown[])[2], ['img', { alt: '', draggable: 'false', 'data-missing': '' }]);
    assert.deepEqual((figure({ assetId: 'ast-1' }, { src: 'https://e.com/a.png', width: 800, height: 450 }) as readonly unknown[])[2], [
      'img',
      { alt: '', draggable: 'false', src: 'https://e.com/a.png', width: '800', height: '450' },
    ]);
  });

  test('a tall image is drawn at most FIGURE_MAX_HEIGHT high, in its proportion (portrait phone photos)', () => {
    assert.equal(FIGURE_MAX_HEIGHT, 560);
    assert.deepEqual((figure({ assetId: 'ast-1' }, { src: 'https://e.com/a.jpg', width: 900, height: 1800 }) as readonly unknown[])[2], [
      'img',
      { alt: '', draggable: 'false', src: 'https://e.com/a.jpg', width: '280', height: '560' },
    ]);
    assert.deepEqual(figureDisplaySize(1600, 900), { width: 996, height: 560 });
    assert.deepEqual(figureDisplaySize(640, 480), { width: 640, height: 480 });
  });

  test('src, credit and size are display only: source refs, AI state and display attrs stay out of the domain attrs', () => {
    const node = blockNode(schema, figureBlock('f1', { assetId: 'ast-1' }, { ai: 'unreviewed', sourceRefs: [REF_A] }));
    assert.equal(node.attrs.src, null);
    assert.equal(node.attrs.credit, null);
    assert.deepEqual(node.attrs.sourceRefs, [REF_A]);
  });
});

describe('figure parse rules (paste)', () => {
  test('a figure copied from this editor keeps its asset, alt, caption and credit', () => {
    const copied = element('figure', { 'data-block-id': 'f1', 'data-asset-id': 'ast-1' }, [
      element('img', { src: 'blob:http://localhost/1', alt: 'Ana' }),
      element('figcaption', {}, [element('cite', {}, [], 'Foto: Ana Prado')], 'Legenda — '),
    ]);
    assert.deepEqual(parse('figure', copied), { blockId: 'f1', assetId: 'ast-1', src: 'blob:http://localhost/1', alt: 'Ana', caption: 'Legenda', credit: 'Foto: Ana Prado' });
  });

  test('an image from another page keeps its http(s) address as the only candidate, without asset', () => {
    assert.deepEqual(parse('img[src]', element('img', { src: 'https://example.com/foto.jpg', alt: 'Praça' })), {
      assetId: null,
      src: 'https://example.com/foto.jpg',
      alt: 'Praça',
    });
    const foreignFigure = element('figure', {}, [element('img', { src: 'https://example.com/b.png' }), element('figcaption', {}, [], 'Vista')]);
    assert.deepEqual(parse('figure', foreignFigure), { assetId: null, src: 'https://example.com/b.png', alt: null, caption: 'Vista', credit: null });
  });

  test('inline data, local files, emoji-sized images and figures without an image are not figures', () => {
    assert.equal(parse('img[src]', element('img', { src: 'data:image/png;base64,AAAA' })), false);
    assert.equal(parse('img[src]', element('img', { src: 'file:///Users/a/foto.png' })), false);
    assert.equal(parse('img[src]', element('img', { src: 'https://example.com/emoji.png', width: '20', height: '20' })), false);
    assert.equal(parse('figure', element('figure', {}, [element('blockquote', {}, [], 'Fala'), element('figcaption', {}, [], 'Autor')])), false);
  });

  test('pasted attributes named like figure attrs are ignored', () => {
    const rule = figureRule('img[src]');
    const attrs = rule.getAttrs?.(element('img', { src: 'https://example.com/a.jpg', caption: 'injetado', credit: 'x' }) as unknown as HTMLElement);
    assert.ok(attrs && typeof attrs === 'object');
    assert.equal((attrs as Record<string, unknown>).caption, undefined);
  });
});

describe('articleExtensions', () => {
  test('includes the placeholder unless turned off', () => {
    const names = (options: Parameters<typeof articleExtensions>[0]) => articleExtensions(options).map((extension) => extension.name);
    assert.ok(names({}).includes('placeholder'));
    assert.equal(names({ placeholder: false }).includes('placeholder'), false);
    assert.equal(DEFAULT_PLACEHOLDERS.heading2, 'Intertítulo');
  });

  test('⌘↵ belongs to the suggestion decisions: the hard break keeps Shift-Enter only', () => {
    const extensions = articleExtensions({});
    const keymap = extensions.find((extension) => extension.name === ArticleKeymap.name);
    const starter = extensions.find((extension) => extension.name === 'starterKit');
    assert.ok(keymap && starter);
    // Higher priority runs first, so StarterKit's HardBreak never sees Mod-Enter.
    assert.ok((keymap.config.priority ?? 100) > (starter.config.priority ?? 100));
    const addShortcuts = ArticleKeymap.config.addKeyboardShortcuts as unknown as (this: unknown) => Record<string, () => boolean>;
    const shortcuts = addShortcuts.call({ editor: {} });
    assert.deepEqual(Object.keys(shortcuts), ['Mod-Enter']);
    assert.equal(shortcuts['Mod-Enter'](), true);
  });
});
