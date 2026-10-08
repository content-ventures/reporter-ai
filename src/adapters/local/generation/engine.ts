import { blockText } from '../../../domain/article.ts';
import type { ArticleBlock } from '../../../domain/article.ts';
import type { RunId, StepId } from '../../../domain/ids.ts';
import { applyRunEvent, foldRun, stampRunEvent } from '../../../domain/run-events.ts';
import type { AwaitingInputRequest, RunEvent, RunEventPayload, RunFold, StreamBlockShape } from '../../../domain/run-events.ts';
import { isRunActive } from '../../../domain/run.ts';
import type { RunError } from '../../../domain/run.ts';
import type { RunListener, RunMeta, StartOptions } from '../../../ports/generation.ts';
import type { Unsubscribe } from '../../../ports/common.ts';
import { chunkWords } from './pacing.ts';
import type { Pacing, Sleep } from './pacing.ts';
import type { Rng } from './random.ts';

/**
 * Run engine of the simulation: one channel per run (events, fold, listeners, abort), plus the
 * helpers executors use to emit steps, stream blocks, fail, pause and replay earlier steps.
 * Every state change goes through `emit`, so the fold is always `foldRun(events)`.
 */

type RunStartedPayload = Extract<RunEventPayload, { type: 'run.started' }>;

/** Outputs a retry may reuse: what a finished step produced (never deltas). */
const REPLAYABLE = new Set<RunEventPayload['type']>(['source.used', 'outline', 'block.completed', 'slide.completed', 'suggestion']);
const TERMINAL = new Set<RunEvent['type']>(['run.completed', 'run.failed', 'run.cancelled']);

/** The single step of a child run (one section written). */
export const CHILD_STEP = 'write';

export type Awaiting = { stepId: StepId; validate: (input: unknown) => boolean; resolve: (input: unknown) => void };

export type RunChannel = {
  meta: RunMeta;
  options: StartOptions;
  events: RunEvent[];
  fold: RunFold;
  listeners: Set<RunListener>;
  controller: AbortController;
  stepOutputs: Map<StepId, RunEventPayload[]>;
  currentStep?: StepId;
  awaiting?: Awaiting;
  /** Executor-specific plan, reused by retries. */
  plan: unknown;
  done: Promise<void>;
};

export type Registry = {
  runs: Map<RunId, RunChannel>;
  watchers: Set<RunListener>;
  open(meta: RunMeta, started: RunStartedPayload, options: StartOptions, plan: unknown): RunChannel;
  adopt(meta: RunMeta, fold: RunFold, plan: unknown): RunChannel;
  emit(channel: RunChannel, payload: RunEventPayload): RunEvent;
  subscribe(channel: RunChannel, listener: RunListener): Unsubscribe;
};

function notify(listeners: Iterable<RunListener>, channel: RunChannel, event: RunEvent): void {
  for (const listener of [...listeners]) {
    try {
      listener({ event, fold: channel.fold, meta: channel.meta });
    } catch {
      // A failing subscriber must never break the run.
    }
  }
}

export function isTerminal(channel: RunChannel): boolean {
  return !isRunActive(channel.fold.run);
}

export function createRegistry(now: () => string): Registry {
  const runs = new Map<RunId, RunChannel>();
  const watchers = new Set<RunListener>();
  const finishers = new WeakMap<RunChannel, () => void>();

  const emit = (channel: RunChannel, payload: RunEventPayload): RunEvent => {
    const event = stampRunEvent(payload, channel.meta.runId, channel.fold.seq + 1, now());
    channel.events.push(event);
    channel.fold = applyRunEvent(channel.fold, event);
    if (payload.type === 'step.started') channel.currentStep = payload.stepId;
    else if (payload.type === 'step.completed' || payload.type === 'step.failed') channel.currentStep = undefined;
    else if (channel.currentStep && REPLAYABLE.has(payload.type)) {
      const outputs = channel.stepOutputs.get(channel.currentStep) ?? [];
      outputs.push(payload);
      channel.stepOutputs.set(channel.currentStep, outputs);
    }
    notify(channel.listeners, channel, event);
    notify(watchers, channel, event);
    if (TERMINAL.has(event.type)) finishers.get(channel)?.();
    return event;
  };

  const register = (meta: RunMeta, events: RunEvent[], fold: RunFold, options: StartOptions, plan: unknown): RunChannel => {
    let resolveDone: () => void = () => undefined;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    const forwardAbort = () => channel.controller.abort();
    /**
     * A finished run keeps its fold (attach reads the snapshot) but lets go of what only a live one
     * needs: the caller's abort listener and the word-by-word deltas (a long session never piles
     * up every stream it ever ran).
     */
    const finish = () => {
      options.signal?.removeEventListener('abort', forwardAbort);
      channel.events = channel.events.filter((event) => event.type !== 'text.delta');
      resolveDone();
    };
    const channel: RunChannel = {
      meta,
      options,
      events,
      fold,
      listeners: new Set(),
      controller: new AbortController(),
      stepOutputs: new Map(),
      plan,
      done,
    };
    finishers.set(channel, finish);
    if (options.signal) {
      if (options.signal.aborted) channel.controller.abort();
      else options.signal.addEventListener('abort', forwardAbort, { once: true });
    }
    runs.set(meta.runId, channel);
    return channel;
  };

  const open = (meta: RunMeta, started: RunStartedPayload, options: StartOptions, plan: unknown): RunChannel => {
    const event = stampRunEvent(started, meta.runId, 1, now());
    const channel = register(meta, [event], foldRun([event]) as RunFold, options, plan);
    notify(watchers, channel, event);
    return channel;
  };

  /** Takes over a run that is already in progress (seeded or persisted): its fold is the starting point. */
  const adopt = (meta: RunMeta, fold: RunFold, plan: unknown): RunChannel => register(meta, [], fold, {}, plan);

  const subscribe = (channel: RunChannel, listener: RunListener): Unsubscribe => {
    channel.listeners.add(listener);
    return () => {
      channel.listeners.delete(listener);
    };
  };

  return { runs, watchers, open, adopt, emit, subscribe };
}

/** Live events after `afterSeq`, ending after the terminal event. */
export function liveEvents(registry: Registry, channel: RunChannel, afterSeq: number): AsyncIterable<RunEvent> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<RunEvent> {
      const queue = channel.events.filter((event) => event.seq > afterSeq);
      let finished = isTerminal(channel);
      let wake: (() => void) | undefined;
      const unsubscribe = registry.subscribe(channel, ({ event }) => {
        queue.push(event);
        if (TERMINAL.has(event.type)) finished = true;
        wake?.();
      });
      return {
        async next(): Promise<IteratorResult<RunEvent>> {
          for (;;) {
            const event = queue.shift();
            if (event) return { value: event, done: false };
            if (finished) {
              unsubscribe();
              return { value: undefined, done: true };
            }
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
            wake = undefined;
          }
        },
        async return(): Promise<IteratorResult<RunEvent>> {
          unsubscribe();
          return { value: undefined, done: true };
        },
      };
    },
  };
}

export type Outcome = 'done' | 'aborted' | 'failed';

/** Reuse of a previous attempt: outputs of the steps before the retried one. */
export type Reuse = { previousRunId: RunId; steps: Map<StepId, RunEventPayload[]> };

export type ChildOpener = (stepId: StepId, label: string, inputs: RunStartedPayload['inputs']) => RunChannel;

export type RunApi = {
  channel: RunChannel;
  rng: Rng;
  pacing: Pacing;
  aborted(): boolean;
  /** Waits; false when the run was aborted meanwhile. */
  wait(ms: number): Promise<boolean>;
  emit(payload: RunEventPayload, also?: RunChannel): void;
  startStep(stepId: StepId, meta?: string): void;
  completeStep(stepId: StepId, meta?: string): void;
  /** Replays a reused step instantly; false when the step has to run. */
  replay(stepId: StepId): boolean;
  /** True when the scenario makes this step fail. */
  failsAt(stepId: StepId): boolean;
  /** Streams a block word by word into the run (and a child run). */
  stream(block: ArticleBlock, child?: RunChannel, options?: { stopAfter?: number }): Promise<Outcome>;
  awaitInput(stepId: StepId, request: AwaitingInputRequest, validate: (input: unknown) => boolean): Promise<unknown>;
  openChild: ChildOpener;
  /** Completes a child run (its single "write" step and the run). */
  finishChild(child: RunChannel, meta?: string): void;
  /** Ends the run (and an open child) as failed at `stepId`. */
  fail(stepId: StepId, error: Omit<RunError, 'stepId'>, child?: RunChannel): void;
  /** Ends the run (and an open child) as cancelled; the partial output stays in the fold. */
  cancel(child?: RunChannel): void;
  complete(): void;
};

export type RunApiDeps = {
  registry: Registry;
  channel: RunChannel;
  rng: Rng;
  pacing: Pacing;
  sleep: Sleep;
  reuse?: Reuse;
  failAt?: StepId;
  openChild: ChildOpener;
};

function shapeOf(block: ArticleBlock): StreamBlockShape {
  const shape: StreamBlockShape = { id: block.id, type: block.type };
  if (block.type === 'heading') shape.level = block.level;
  if (block.type === 'list') shape.ordered = block.ordered;
  return shape;
}

export function createRunApi(deps: RunApiDeps): RunApi {
  const { registry, channel, rng, pacing, sleep } = deps;
  const signal = channel.controller.signal;
  const aborted = () => signal.aborted;
  const emit = (payload: RunEventPayload, also?: RunChannel) => {
    registry.emit(channel, payload);
    if (also) registry.emit(also, payload);
  };
  const stepState = (stepId: StepId) => channel.fold.run.steps.find((step) => step.id === stepId)?.state;
  const wait = async (ms: number): Promise<boolean> => {
    if (aborted()) return false;
    await sleep(ms, signal);
    return !aborted();
  };

  return {
    channel,
    rng,
    pacing,
    aborted,
    wait,
    emit,
    startStep(stepId, meta) {
      if (stepState(stepId) === 'current' && !meta) return;
      emit(meta ? { type: 'step.started', stepId, meta } : { type: 'step.started', stepId });
    },
    completeStep(stepId, meta) {
      emit(meta ? { type: 'step.completed', stepId, meta } : { type: 'step.completed', stepId });
    },
    replay(stepId) {
      // An adopted run already finished this step in its earlier life: nothing to emit.
      if (stepState(stepId) === 'done') return true;
      const outputs = deps.reuse?.steps.get(stepId);
      if (!outputs) return false;
      emit({ type: 'step.started', stepId });
      for (const payload of outputs) emit(payload);
      emit({ type: 'step.completed', stepId, meta: 'Reaproveitado da tentativa anterior' });
      return true;
    },
    failsAt(stepId) {
      return deps.failAt === stepId;
    },
    async stream(block, child, options = {}) {
      // An adopted run may already hold this block, complete or partially streamed.
      const existing = channel.fold.blocks.find((entry) => entry.id === block.id);
      if (existing?.complete) return 'done';
      const text = blockText(block);
      if (existing) {
        if (child) registry.emit(child, { type: 'block.started', block: shapeOf(block) });
        if (!text.startsWith(existing.text)) {
          // The partial does not match the plan: settle the block with the planned text.
          emit({ type: 'block.completed', block }, child);
          return 'done';
        }
        if (existing.text && child) registry.emit(child, { type: 'text.delta', blockId: block.id, delta: existing.text });
      } else {
        emit({ type: 'block.started', block: shapeOf(block) }, child);
      }
      const chunks = chunkWords(text.slice(existing?.text.length ?? 0), rng);
      const limit = options.stopAfter === undefined ? chunks.length : Math.max(1, Math.floor(chunks.length * options.stopAfter));
      for (let index = 0; index < Math.min(limit, chunks.length); index += 1) {
        if (!(await wait(pacing.chunkDelay()))) return 'aborted';
        emit({ type: 'text.delta', blockId: block.id, delta: chunks[index] }, child);
      }
      if (limit < chunks.length) return 'failed';
      if (aborted()) return 'aborted';
      emit({ type: 'block.completed', block }, child);
      return 'done';
    },
    awaitInput(stepId, request, validate) {
      // Arm the resume handle BEFORE announcing the pause: a listener may resume synchronously.
      const pending = new Promise<unknown>((resolve) => {
        if (aborted()) {
          resolve(undefined);
          return;
        }
        const onAbort = () => {
          channel.awaiting = undefined;
          resolve(undefined);
        };
        signal.addEventListener('abort', onAbort, { once: true });
        channel.awaiting = {
          stepId,
          validate,
          resolve: (input) => {
            signal.removeEventListener('abort', onAbort);
            channel.awaiting = undefined;
            resolve(input);
          },
        };
      });
      emit({ type: 'step.awaiting_input', stepId, request });
      return pending;
    },
    openChild: deps.openChild,
    finishChild(child, meta) {
      registry.emit(child, meta ? { type: 'step.completed', stepId: CHILD_STEP, meta } : { type: 'step.completed', stepId: CHILD_STEP });
      registry.emit(child, { type: 'run.completed' });
    },
    fail(stepId, error, child) {
      const full: RunError = { ...error, stepId };
      if (child && !isTerminal(child)) {
        registry.emit(child, { type: 'step.failed', stepId: CHILD_STEP, error: full });
        registry.emit(child, { type: 'run.failed', error: full });
      }
      emit({ type: 'step.failed', stepId, error: full });
      emit({ type: 'run.failed', error: full });
    },
    cancel(child) {
      if (child && !isTerminal(child)) registry.emit(child, { type: 'run.cancelled', reason: 'Interrompida' });
      if (!isTerminal(channel)) emit({ type: 'run.cancelled', reason: 'Interrompida' });
    },
    complete() {
      emit({ type: 'run.completed' });
    },
  };
}
