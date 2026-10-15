import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appOrigins, workerUrl } from '../src/server/worker-config.ts';

test('the worker URL is configured per environment and must be HTTPS outside loopback', () => {
  assert.equal(workerUrl({}), undefined);
  assert.equal(workerUrl({ REPORTER_WORKER_URL: 'https://br-main-reporterworker.example.dev/' }), 'https://br-main-reporterworker.example.dev');
  assert.equal(workerUrl({ REPORTER_WORKER_URL: 'http://127.0.0.1:8787' }), 'http://127.0.0.1:8787');
  for (const value of ['http://worker.example.dev', 'https://user:secret@worker.example.dev', 'https://worker.example.dev/?key=x', 'not a url'])
    assert.throws(() => workerUrl({ REPORTER_WORKER_URL: value }), /WORKER_CONFIGURATION/, value);
});

test('upload origins are an explicit list, with the legacy single origin still accepted', () => {
  assert.deepEqual(appOrigins({}), []);
  assert.deepEqual(appOrigins({ REPORTER_APP_ORIGIN: 'https://reporter.example' }), ['https://reporter.example']);
  assert.deepEqual(appOrigins({ REPORTER_APP_ORIGINS: 'https://reporter.example, https://staging.reporter.example,https://reporter.example',
    REPORTER_APP_ORIGIN: 'https://ignored.example' }), ['https://reporter.example', 'https://staging.reporter.example']);
  assert.deepEqual(appOrigins({ REPORTER_APP_ORIGINS: 'http://127.0.0.1:3000' }), ['http://127.0.0.1:3000']);
  for (const value of ['https://reporter.example/path', 'http://reporter.example', 'reporter.example'])
    assert.throws(() => appOrigins({ REPORTER_APP_ORIGINS: value }), /UPLOAD_CONFIGURATION/, value);
});
