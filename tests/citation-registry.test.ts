import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ArticleBody } from '../src/domain/article.ts';
import { citationId, locateCitation } from '../src/domain/citation-library.ts';
import type { Citation } from '../src/domain/citation-library.ts';
import { createTranscriptSource } from '../src/domain/source.ts';
import { parseTranscript } from '../src/domain/text/transcript-parse.ts';
import type { EditorialCheckpoint } from '../src/ports/connected-workspace.ts';
import { citationRegistry } from '../src/server/citation-library.ts';

const now = '2026-10-21T12:00:00Z';
const QUOTED = 'O controle de temperatura precisa acompanhar o pescado durante todo o transporte.';
const UNQUOTED = 'A fábrica passou a operar em dois turnos em março.';

function workspace() {
  const source = createTranscriptSource({ workspaceId: 'workspace', title: 'Entrevista sintética', origin: 'interview', authorized: true,
    parsed: parseTranscript(`Ana Costa: ${QUOTED} ${UNQUOTED}\nPedro Lima: Obrigado pela entrevista.`, { format: 'speaker-lines' }), speakerPeople: { 'Ana Costa': 'ana' } },
  { now, actorId: 'editor', newId: () => 'source' });
  const body: ArticleBody = { type: 'article', title: 'Teste', blocks: [{ id: 'p', type: 'paragraph', inlines: [{ text: `Ela disse: “${QUOTED}”` }],
    sourceRefs: [{ kind: 'source', sourceId: source.id, sourceVersion: 1, locator: { type: 'segment', segmentId: source.versions[0].content.segments[0].id } }] }] };
  const checkpoint = { state: { members: [], sessionPersonId: 'editor', people: [{ id: 'ana', name: 'Ana Costa' }], sources: [source],
    productions: [{ production: { id: 'production', sourceIds: [source.id] }, pieces: [{ draft: { body, updatedAt: now } }], versions: [] }] },
  jobs: {} } as unknown as EditorialCheckpoint;
  const suggestion = (text: string, changes: Partial<Citation> = {}): Citation => {
    const located = locateCitation(source, 1, text)!;
    return { id: citationId(located.ref, located.text), revision: 0, origin: 'outline', text: located.text, ref: located.ref, sourceHash: located.hash,
      productionId: 'production', createdAt: now, updatedAt: now, authorConfirmed: false, personId: 'ana', relevance: '', ...changes };
  };
  return { checkpoint, suggestion };
}

test('the registry shows a text quotation over an untouched suggestion of the same words, and an edited one over the text', () => {
  const { checkpoint, suggestion } = workspace();
  checkpoint.citations = [suggestion(QUOTED), suggestion(UNQUOTED)];
  const items = citationRegistry(checkpoint).items;
  const quoted = items.find(item => item.text === QUOTED)!, suggested = items.find(item => item.text === UNQUOTED)!;
  assert.equal(items.length, 2);
  assert.equal(quoted.origin, 'article');
  assert.equal(quoted.authorConfirmed, true);
  assert.equal(suggested.origin, 'outline');
  assert.equal(suggested.speaker, 'Ana Costa');
  assert.equal(suggested.ready, false);
  checkpoint.citations = [suggestion(QUOTED, { revision: 1, relevance: 'Mostra o cuidado com a cadeia fria.' })];
  assert.equal(citationRegistry(checkpoint).items.find(item => item.text === QUOTED)?.origin, 'outline', 'a person touched it: the stored entry wins');
});
