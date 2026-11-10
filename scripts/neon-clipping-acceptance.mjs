import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';
import { CLIPPING_SEGMENTS, clippingBlocked } from '../src/domain/news-clipping.ts';

const feeds = [
  ['Fish Focus', 'https://fishfocus.co.uk/feed/'],
  ['Panorama da Aquicultura', 'https://panoramadaaquicultura.com.br/feed/'],
  ['Feed & Additive', 'https://www.feedandadditive.com/feed/'],
];

/** Runs inside a disposable workspace on the already verified staging branch. */
export async function acceptLiveClipping({ ok, call, editor, client, environment }) {
  assert.ok(environment.TAVILY_API_KEY?.trim(), 'Live clipping needs the configured staging Tavily key');
  const path = `w/${client.slug}/news`;
  const initial = await ok(editor, `${path}/search`);
  const config = { portalUrl: 'https://seafoodbrasil.com.br', sector: 'Pesca e aquicultura', region: 'Brasil',
    topics: CLIPPING_SEGMENTS.map(segment => segment.label), languages: ['pt', 'en', 'es'], excludedDomains: [],
    everyMinutes: 360, dailyLimit: 12, enabled: true, windowHours: 24 };
  const saved = await ok(editor, `${path}/search`, { revision: initial.revision, config });
  const start = Date.now();
  try {
    assert.equal(saved.clipping, true, 'The Seafood clipping policy must be active');
    // The in-process HTTP fixture defers work. Wake the deployed staging worker after saving.
    const wake = await fetch(new URL('/drain', environment.REPORTER_WORKER_URL), { method: 'POST',
      headers: { 'x-reporter-worker-key': environment.REPORTER_WORKER_PASSWORD }, signal: AbortSignal.timeout(15_000) });
    await wake.body?.cancel();
    assert.equal(wake.status, 202, 'The staging worker did not accept the drain request');

    let view = saved;
    const deadline = start + 240_000;
    while (view.state !== 'limited' && Date.now() < deadline) {
      assert.ok(!view.lastError, `Staging Tavily search failed with ${view.lastError}`);
      await wait(3_000);
      view = await ok(editor, `${path}/search`);
    }
    assert.equal(view.state, 'limited', `Tavily did not finish the staging budget (${view.usedToday} attempted)`);
    assert.equal(view.usedToday, config.dailyLimit);
    assert.equal(view.lastError, undefined, 'The final Tavily request failed');
    const web = (await ok(editor, path)).items.filter(item => item.via === 'tavily');
    assert.ok(web.length > 0, 'No real Tavily story passed the 24-hour clipping rules');

    for (const [name, url] of feeds) {
      const { source } = await ok(editor, `${path}/sources`, { kind: 'rss', name, url, everyMinutes: 60 });
      assert.equal(source.state, 'active', `${name} did not activate`);
      assert.ok(source.lastReadAt, `${name} did not finish its first real read`);
    }
    const rss = (await ok(editor, path)).items.filter(item => item.via === 'rss');
    assert.ok(rss.length > 0, 'No real feed story passed the 24-hour clipping rules');
    const segments = new Set(CLIPPING_SEGMENTS.map(segment => segment.id));
    for (const item of [...web, ...rss]) {
      assert.ok(segments.has(item.clippingSegment), 'A story had no valid clipping segment');
      assert.ok(!clippingBlocked(item.url), 'A blocked domain reached the staging Radar');
      const date = Date.parse(item.publishedAt);
      assert.ok(date >= start - 86_400_000 && date <= Date.now(), 'A story was outside the 24-hour collection window');
    }
    assert.equal((await call(editor, `${path}/links`, { url: config.portalUrl })).status, 422, 'The client site was not blocked');
    console.log(`PASS staging live clipping: ${view.usedToday} Tavily searches, ${web.length} Tavily stories, ${rss.length} RSS stories across ${feeds.length} verified feeds, client domain blocked.`);
  } finally {
    const current = await ok(editor, `${path}/search`);
    await ok(editor, `${path}/search`, { revision: current.revision, config: { ...config, enabled: false } });
  }
}
