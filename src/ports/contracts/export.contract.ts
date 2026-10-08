import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ProductionId } from '../../domain/ids.ts';
import type { VersionRef } from '../../domain/refs.ts';
import type { ExportService } from '../export.ts';

/**
 * ExportService contract (REQ-1.6, REQ-T.2): only approved versions leave, never a carousel
 * written from another article version than the one in the package, and every format the
 * adapter cannot produce stays listed with its reason. Local and server adapters must pass.
 */

export type ExportUnderTest = {
  exports: ExportService;
  productionId: ProductionId;
  /** Approves the article, derives the carousel from it and approves the carousel. */
  approveAll(): Promise<{ article: VersionRef; carousel: VersionRef }>;
  /** Approves a NEWER article version while the carousel stays derived from the older one. */
  approveNewerArticle(): Promise<VersionRef>;
  dispose?(): void | Promise<void>;
};

export type ExportFactory = () => ExportUnderTest | Promise<ExportUnderTest>;

async function using(make: ExportFactory, test: (sut: ExportUnderTest) => Promise<void>): Promise<void> {
  const sut = await make();
  try {
    await test(sut);
  } finally {
    await sut.dispose?.();
  }
}

export function exportContract(name: string, make: ExportFactory): void {
  describe(`${name} · export contract`, () => {
    it('refuses to export anything that is not approved', () =>
      using(make, async (sut) => {
        const refused = await sut.exports.build({ productionId: sut.productionId });
        assert.equal(refused.ok, false);
      }));

    it('builds the approved package with the full file list and a manifest', () =>
      using(make, async (sut) => {
        const { article, carousel } = await sut.approveAll();
        const built = await sut.exports.build({ productionId: sut.productionId });
        assert.ok(built.ok, built.ok ? '' : built.refusal.message);
        const pkg = built.value;
        const names = pkg.files.map((file) => file.fileName);
        assert.ok(names.includes(`artigo-v${article.number}.md`));
        assert.ok(names.includes(`artigo-v${article.number}.html`));
        assert.ok(names.includes(`carrossel-v${carousel.number}.json`));
        assert.ok(names.some((fileName) => /^carrossel-v\d+-slide-\d{2}\.png$/.test(fileName)));
        assert.ok(names.includes('manifesto.json'));
        for (const file of pkg.files) {
          if (!file.available) assert.ok(file.unavailableReason && file.status === 'unavailable', `${file.fileName} says why it is disabled`);
          if (file.status === 'ready') assert.ok(file.href?.startsWith('data:') || file.href?.startsWith('http'), `${file.fileName} has a link`);
        }
        const html = pkg.files.find((file) => file.format === 'html');
        assert.ok(html?.text && !/<style\b/i.test(html.text) && !/\sstyle=/i.test(html.text) && !/\sclass=/i.test(html.text), 'semantic HTML, no styling');
        assert.equal(pkg.manifest.items.length, 2);
        assert.ok(pkg.manifest.sources.every((source) => source.hash && source.version >= 1));
        assert.ok(pkg.manifest.items.every((item) => item.decisionId && item.approvedBy && item.hash));
        assert.ok(pkg.deliveryItems.length > 0 && pkg.deliveryItems.every((item) => [article.versionId, carousel.versionId].includes(item.version.versionId)));
        const again = await sut.exports.plan({ productionId: sut.productionId });
        assert.ok(again.ok && again.value.idempotencyKey === pkg.plan.idempotencyKey, 'same package, same idempotency key');
      }));

    it('refuses a carousel written from another article version, offering the coherent pair', () =>
      using(make, async (sut) => {
        const { article } = await sut.approveAll();
        const newer = await sut.approveNewerArticle();
        assert.notEqual(newer.versionId, article.versionId);
        const mixed = await sut.exports.plan({ productionId: sut.productionId });
        assert.equal(!mixed.ok && mixed.refusal.code, 'mixed_versions');
        const alternative = !mixed.ok ? (mixed.refusal.details?.exportWithParent as VersionRef[] | undefined) : undefined;
        assert.ok(alternative?.some((ref) => ref.versionId === article.versionId), '"Exportar com artigo vN" is offered');
        const coherent = await sut.exports.build({ productionId: sut.productionId, selection: alternative });
        assert.ok(coherent.ok);
      }));

    it('refuses a selection whose hash does not match the stored version', () =>
      using(make, async (sut) => {
        const { article, carousel } = await sut.approveAll();
        const tampered = await sut.exports.plan({ productionId: sut.productionId, selection: [{ ...article, hash: 'deadbeef' }, carousel] });
        assert.equal(!tampered.ok && tampered.refusal.code, 'unknown_version');
      }));
  });
}
