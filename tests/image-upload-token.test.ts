import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { completeAssetUpload } from '../src/server/image-assets.ts';
import { runWithReporterContext, type ReporterRequestContext } from '../src/server/request-context.ts';
import { FlowError } from '../src/server/errors.ts';

test('signed image uploads accept seeded identities while enforcing expiry and request scope', async () => {
  const previous = process.env.REPORTER_WORKER_PASSWORD;
  process.env.REPORTER_WORKER_PASSWORD = 'image-upload-test-secret';
  const context: ReporterRequestContext = {
    tenant: '10000000-0000-0000-0000-000000000001',
    portal: '10000000-0000-0000-0000-000000000101', actor: randomUUID(),
    workspaceName: 'Acceptance', workspaceSlug: 'acceptance', name: 'Editor',
    email: 'editor@example.invalid', roles: ['editor'],
  };
  function signed(values: Record<string, unknown> = {}) {
    const body = Buffer.from(JSON.stringify({
      id: randomUUID(), fileName: 'image.png', mime: 'image/png', size: 100,
      hash: 'a'.repeat(64), meta: { productionId: randomUUID(), authorized: true },
      actor: context.actor, portal: context.portal, expires: Date.now() + 60_000, ...values,
    })).toString('base64url');
    return body + '.' + createHmac('sha256', process.env.REPORTER_WORKER_PASSWORD!).update(body).digest('base64url');
  }
  const denied = (error: unknown) => error instanceof FlowError && error.code === 'ORIGIN_DENIED' && error.status === 403;
  async function reject(values: Record<string, unknown>) {
    await assert.rejects(() => runWithReporterContext(context, () => completeAssetUpload({ token: signed(values) })), denied);
  }
  try {
    // Reaching the expiry check proves seeded IDs pass parsing; no storage or DB is accessed.
    await reject({ expires: 0 });
    context.portal = '00000000-0000-0000-0000-000000000101';
    context.actor = '00000000-0000-0000-0000-000000000031';
    await reject({ expires: 0 });
    await reject({ actor: randomUUID() });
    await reject({ portal: randomUUID() });
    await assert.rejects(() => runWithReporterContext(context, () => completeAssetUpload({ token: signed() + 'x' })), denied);
    await assert.rejects(() => runWithReporterContext(context, () => completeAssetUpload({ token: signed({ portal: '../other' }) })), { name: 'ZodError' });
  } finally {
    if (previous === undefined) delete process.env.REPORTER_WORKER_PASSWORD;
    else process.env.REPORTER_WORKER_PASSWORD = previous;
  }
});
