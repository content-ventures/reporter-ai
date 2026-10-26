import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { CLOUD, LOCAL_FLOW } from './migrations.mjs';
import { migrationBody } from './migration-body.mjs';

test('all registered cloud and local migrations compose into one transaction without committing partial definitions', async () => {
  for (const path of new Set([...CLOUD,...LOCAL_FLOW])) {
    const source = await readFile(new URL('../../'+path,import.meta.url),'utf8');
    assert.ok(migrationBody(source).includes('CREATE') || migrationBody(source).includes('INSERT') || migrationBody(source).includes('ALTER') || migrationBody(source).includes('UPDATE'), path);
  }
});
test('a missing or extra transaction boundary fails closed', () => {
  for (const source of ['SELECT 1;', 'BEGIN; SELECT 1;', 'BEGIN;\nCOMMIT;\nBEGIN;\nSELECT 2;\nCOMMIT;']) assert.throws(() => migrationBody(source));
  assert.equal(migrationBody('-- header\nBEGIN;\nDO $$ BEGIN PERFORM 1; END $$;\nCOMMIT;\n'), '-- header\n\nDO $$ BEGIN PERFORM 1; END $$;\n');
});
