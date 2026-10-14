import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { test } from 'node:test';
import { join } from 'node:path';
import { defaultPipelineDefinition, pipelineRevision } from '../src/domain/pipeline.ts';
import { runMaterialAnalysis } from '../src/server/material-analysis.ts';
import { storageRoot } from '../src/server/storage.ts';

test('Vercel material analysis succeeds and reuses its cache with a read-only deployment directory', async context => {
  const root = '/tmp/reporter-ai', files = new Map<string, string>();
  const text = 'Fonte de teste sobre oficinas de leitura em bibliotecas.';
  const insights = { title: 'Oficinas de leitura', participants: [] };
  const previous = { VERCEL: process.env.VERCEL, REPORTER_FUNCTION_RUNTIME: process.env.REPORTER_FUNCTION_RUNTIME,
    GROQ_API_KEY: process.env.GROQ_API_KEY };
  process.env.VERCEL = '1';
  delete process.env.REPORTER_FUNCTION_RUNTIME;
  process.env.GROQ_API_KEY = 'test-placeholder-not-a-real-key';
  const missing = () => Object.assign(new Error('Missing file'), { code: 'ENOENT' });
  const writable = (path: unknown) => {
    const value = String(path);
    if (value !== root && !value.startsWith(root + '/')) throw missing();
    return value;
  };
  // Model a Linux function: /var/task is read-only; only /tmp is writable.
  context.mock.method(process, 'cwd', () => '/var/task');
  context.mock.method(fs, 'mkdir', async (path: unknown) => { writable(path); });
  context.mock.method(fs, 'lstat', async (path: unknown) => {
    const value = writable(path);
    if (value !== root && !files.has(value)) throw missing();
    return { isDirectory: () => value === root, isSymbolicLink: () => false };
  });
  context.mock.method(fs, 'realpath', async (path: unknown) => writable(path));
  context.mock.method(fs, 'readFile', async (path: unknown) => {
    const value = files.get(writable(path));
    if (value === undefined) throw missing();
    return value;
  });
  context.mock.method(fs, 'writeFile', async (path: unknown, value: unknown) => { files.set(writable(path), String(value)); });
  context.mock.method(fs, 'rename', async (from: unknown, to: unknown) => {
    const source = writable(from), destination = writable(to);
    if (!files.has(source)) throw missing();
    files.set(destination, files.get(source)!); files.delete(source);
  });
  syncBuiltinESMExports();
  const provider = context.mock.method(globalThis, 'fetch', async () => Response.json({
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(insights) } }],
  }));
  try {
    const directory = await storageRoot(), pipeline = pipelineRevision(defaultPipelineDefinition(), 10);
    const first = await runMaterialAnalysis(text, {}, pipeline, directory);
    const second = await runMaterialAnalysis(text, {}, pipeline, await storageRoot());
    assert.deepEqual(first, { ...insights, pipelineRevision: 10 });
    assert.deepEqual(second, first);
    assert.equal(provider.mock.callCount(), 1);
    assert.equal(files.size, 1);
    assert.ok([...files.keys()].every(path => path.startsWith(join(root, 'material-')) && path.endsWith('.json')));
  } finally {
    context.mock.restoreAll();
    syncBuiltinESMExports();
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});
