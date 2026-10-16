import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ok, refuse } from '../../src/domain/result.ts';
import { compactRunPreviews } from '../../src/domain/run-events.ts';
import { isRunActive } from '../../src/domain/run.ts';
import type { PortsUnderTest } from '../../src/ports/contracts/fixture.ts';
import type { ConnectedWorkspace, WorkspaceRefresh } from '../../src/ports/connected-workspace.ts';
import type { FeedbackPort } from '../../src/ports/feedback.ts';
import type { ProductionCommands } from '../../src/ports/production-commands.ts';
import type { SessionPort } from '../../src/ports/session.ts';
import { createEditorialEngine } from '../../src/runtime/editorial-engine.ts';
import { applyWorkspaceDelta } from '../../src/runtime/editorial-sync.ts';
import type { handleReporter } from '../../src/server/http.ts';

export type ContractPerson = { id: string; identity: { subject: string; email: string; name: string; image: undefined; emailVerified: true } };
export type RowsWorld = {
  handle: typeof handleReporter;
  origin: string;
  templateId: string;
  /** Empties the portal's editorial rows: every contract starts from a fresh workspace. */
  reset(): Promise<void>;
  advance(ms: number): void;
  people: { editor: ContractPerson; approver: ContractPerson; editorOnly: ContractPerson; creativeReviewer: ContractPerson };
};

// What the browser shows: finished runs keep their fold, and previews collapse to the latest.
function comparable(workspace: ConnectedWorkspace) {
  const jobs = Object.fromEntries(Object.entries(workspace.jobs).map(([id, job]) => [id, { meta: job.meta, kind: job.kind,
    events: isRunActive(workspace.state.runFolds[id]?.run ?? { status: 'completed' }) ? compactRunPreviews(job.events) : [] }]));
  return { state: workspace.state, jobs, imageAssets: workspace.imageAssets ?? [] };
}

/**
 * The browser's view of the server, without a browser. Commands go through the HTTP handler to
 * the editorial rows; queries read an engine mirror kept current by the snapshot and delta merge
 * the connected runtime uses. After every command the merged mirror must equal a fresh snapshot.
 */
export async function rowsPortsUnderTest(world: RowsWorld): Promise<PortsUnderTest> {
  await world.reset();
  let actor = world.people.editor;
  const send = async (path: string, body?: unknown) => {
    const request = new Request(`${world.origin}/api/reporter/${path}`, body === undefined ? undefined : { method: 'POST',
      headers: { origin: world.origin, 'content-type': 'application/json', 'x-reporter-client': 'local' }, body: JSON.stringify(body) });
    const response = await world.handle(request, path.split('?')[0].split('/'), { defer: () => {}, identify: async () => actor.identity });
    return { status: response.status, value: await response.json() as unknown };
  };
  const call = async <T,>(path: string, body?: unknown): Promise<T> => {
    const { status, value } = await send(path, body);
    if (status !== 200) throw new Error(`${path} answered ${status}: ${JSON.stringify(value)}`);
    return value as T;
  };
  let current = await call<ConnectedWorkspace>('workspace');
  const checkpoint = { ...current };
  const engine = createEditorialEngine(checkpoint, { next: () => randomUUID() });
  const adopt = (productionIds: string[]) => {
    checkpoint.imageAssets = current.imageAssets;
    engine.store.transact(() => ok({ state: current.state, value: undefined, persist: 'none', scope: 'external', productionIds }));
  };
  const refresh = async () => {
    const refreshed = await call<WorkspaceRefresh>(`workspace?since=${encodeURIComponent(current.syncToken ?? '')}`);
    if ('unchanged' in refreshed) return;
    if ('delta' in refreshed) {
      const merged = applyWorkspaceDelta(current, { ...refreshed, seq: refreshed.revision });
      current = { ...merged.workspace, syncToken: refreshed.syncToken };
      adopt(merged.productionIds);
    } else {
      current = refreshed;
      adopt(current.state.productions.map(entry => entry.production.id));
    }
    assert.deepEqual(comparable(current), comparable(await call<ConnectedWorkspace>('workspace')), 'merged deltas equal a fresh snapshot');
  };
  // The server refuses some commands before the engine sees them (role in SQL, input shape); the
  // contract reads those as refusals that changed nothing, as the browser does: a role refusal by
  // its code (FORBIDDEN), never by the status alone.
  const REFUSALS: Record<number, string> = { 409: 'conflict', 422: 'invalid_input' };
  const rpc = async <T,>(method: string, args: unknown[]): Promise<T> => {
    const { status, value } = await send('workspace', { method, args, requestId: randomUUID() });
    if ((value as { error?: unknown })?.error === 'FORBIDDEN') return refuse('forbidden', JSON.stringify(value)) as T;
    if (REFUSALS[status]) return refuse(REFUSALS[status], JSON.stringify(value)) as T;
    if (status !== 200) throw new Error(`${method} answered ${status}: ${JSON.stringify(value)}`);
    await refresh();
    return value as T;
  };
  const commands = Object.fromEntries(Object.keys(engine.commands).map(method =>
    [method, (...args: unknown[]) => rpc(method, args)])) as unknown as ProductionCommands;
  const session: SessionPort = { mode: 'remote', workspace: () => engine.session.workspace(), current: () => engine.session.current(),
    members: () => engine.session.members(), subscribe: listener => engine.session.subscribe(listener) };
  const feedback: FeedbackPort = { record: input => rpc('recordFeedback', [input]), vote: input => rpc('feedback.vote', [input]),
    list: query => engine.feedback.list(query) };
  const people = world.people;
  return {
    queries: engine.queries, commands, ingest: engine.ingest, session, feedback,
    people: { editor: people.editor.id, approver: people.approver.id, editorOnly: people.editorOnly.id, creativeReviewer: people.creativeReviewer.id },
    carouselTemplateId: world.templateId,
    enforcesR1Articles: true,
    validatesBeforeEngine: true,
    async actAs(personId) {
      const next = Object.values(people).find(person => person.id === personId);
      if (!next) throw new Error(`Unknown contract person ${personId}`);
      actor = next;
      await refresh();
    },
    async advance(ms) { world.advance(ms); },
    dispose() { engine.store.dispose(); },
  };
}
