import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ProductionRoute } from '../../ui/routes.ts';
import { productionDocumentTitle, productionTrail, stageCrumbLabel } from './trail.ts';

const LINKS = { productions: '/productions' };
const TITLE = { label: 'Ateliê Sul', href: '/productions/prod-atelie-sul/article' };

const ROUTES: [ProductionRoute, string | undefined][] = [
  [{ kind: 'source' }, 'Material'],
  [{ kind: 'studio', pieceKind: 'article' }, 'Artigo'],
  [{ kind: 'review', pieceKind: 'article' }, 'Aprovação do artigo'],
  [{ kind: 'studio', pieceKind: 'carousel' }, 'Carrossel'],
  [{ kind: 'review', pieceKind: 'carousel' }, 'Aprovação do carrossel'],
  [{ kind: 'delivery' }, 'Entrega'],
  [{ kind: 'index' }, undefined],
  [{ kind: 'unknown' }, undefined],
];

describe('production trail (breadcrumbs only, no back link)', () => {
  it('names the stage from the route alone, the carousel review included', () => {
    for (const [route, label] of ROUTES) assert.equal(stageCrumbLabel(route), label, route.kind);
  });

  it('every stage: "Produções › <título> › <etapa>", every level but the last a link', () => {
    for (const [route, label] of ROUTES.filter(([, stage]) => stage)) {
      assert.deepEqual(
        productionTrail(route, { ...LINKS, title: TITLE }),
        [
          { label: 'Produções', href: '/productions' },
          { label: 'Ateliê Sul', href: TITLE.href },
          { label },
        ],
        route.kind,
      );
    }
  });

  it('without the title (loading, the shell default, an error) the stage stays and Produções is a link', () => {
    assert.deepEqual(productionTrail({ kind: 'review', pieceKind: 'carousel' }, LINKS), [
      { label: 'Produções', href: '/productions' },
      { label: 'Aprovação do carrossel' },
    ]);
  });

  it('with neither title nor stage a neutral leaf keeps Produções a link (index while loading or refused, 404)', () => {
    assert.deepEqual(productionTrail({ kind: 'index' }, LINKS), [{ label: 'Produções', href: '/productions' }, { label: 'Produção' }]);
    assert.deepEqual(productionTrail({ kind: 'unknown' }, LINKS), [
      { label: 'Produções', href: '/productions' },
      { label: 'Página não encontrada' },
    ]);
  });

  it('on the index the title is the current level', () => {
    assert.deepEqual(productionTrail({ kind: 'index' }, { ...LINKS, title: TITLE }), [
      { label: 'Produções', href: '/productions' },
      { label: 'Ateliê Sul' },
    ]);
  });

  it('the tab title uses the same labels; none while the production loads', () => {
    assert.equal(productionDocumentTitle({ kind: 'review', pieceKind: 'article' }, 'Aurora'), 'Aurora · Aprovação do artigo');
    assert.equal(productionDocumentTitle({ kind: 'delivery' }, 'Bella Passo'), 'Bella Passo · Entrega');
    assert.equal(productionDocumentTitle({ kind: 'index' }, 'Lume'), 'Lume');
    assert.equal(productionDocumentTitle({ kind: 'source' }, undefined), null);
  });
});
