'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { ProductionId, VersionRef } from '@/domain';
import type { BuiltFile, ExportPlan } from '@/ports';
import { useCommands } from '@/state';
import { selectionKey, type FileProgress } from './delivery-model';

/**
 * Prepares the exact package for download, one file at a time (the "progresso por arquivo" of
 * the states matrix): plan → each article/slide/JSON file → manifest last. Files live only in
 * this screen (data URLs from the ExportService); nothing is recorded until the package leaves.
 * Download links are DS anchors (`ButtonLink href download`) registered with `anchorRef`, so the
 * screen never creates DOM: "Baixar" clicks the anchors it already rendered.
 */

export type PackageJob = {
  key: string | null;
  plan?: ExportPlan;
  progress: Record<string, FileProgress>;
  refusal?: { code: string; message: string };
};

export type PackageState = {
  status: 'idle' | 'preparing' | 'ready' | 'refused';
  plan?: ExportPlan;
  progress: Readonly<Record<string, FileProgress>>;
  refusal?: { code: string; message: string };
  /** Files built (ready or failed) out of the files that can be built. */
  done: number;
  total: number;
  failed: number;
  bytes: number;
};

const EMPTY: Record<string, FileProgress> = {};
const DOWNLOAD_GAP_MS = 220;

function fromBuilt(file: BuiltFile): FileProgress {
  if (file.status === 'ready' && file.href) return { state: 'ready', href: file.href, bytes: file.bytes };
  if (file.status === 'unavailable') return { state: 'unavailable', reason: file.unavailableReason ?? 'Formato ainda não disponível.' };
  return { state: 'failed', error: file.error ?? { code: 'build_failed', message: 'Não foi possível gerar o arquivo.' } };
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function usePackage(productionId: ProductionId, selection: readonly VersionRef[] | undefined) {
  const commands = useCommands();
  const key = selection && selection.length > 0 ? selectionKey(productionId, selection) : null;

  // The exact selection, held per key: a refetched DeliveryView with the same versions never
  // rebuilds the package.
  const [target, setTarget] = useState<{ key: string | null; selection?: readonly VersionRef[] }>({ key: null });
  if (target.key !== key) setTarget({ key, selection });

  // "Preparar de novo" (⌘K › Entrega), optionally with the simulated partial failure.
  const [round, setRound] = useState<{ n: number; simulation?: string }>({ n: 0 });
  const jobKey = target.key ? `${target.key}#${round.n}` : null;
  const [job, setJob] = useState<PackageJob>({ key: null, progress: EMPTY });
  const anchors = useRef(new Map<string, HTMLAnchorElement>());
  const prepared = useRef<{ key: string; files: Map<string, BuiltFile>; manifestAttempt: number } | undefined>(undefined);

  const patch = useCallback((forKey: string, fileName: string, next: FileProgress) => {
    setJob((current) => (current.key === forKey ? { ...current, progress: { ...current.progress, [fileName]: next } } : current));
  }, []);

  useEffect(() => {
    const exact = target.selection;
    if (!jobKey || !exact) return undefined;
    let live = true;
    const request = { productionId, selection: [...exact] };
    void (async () => {
      const planned = await commands.export.plan(request);
      if (!live) return;
      if (!planned.ok) {
        setJob({ key: jobKey, progress: EMPTY, refusal: { code: planned.refusal.code, message: planned.refusal.message } });
        return;
      }
      const plan = planned.value;
      const progress: Record<string, FileProgress> = {};
      for (const file of plan.files) {
        progress[file.fileName] = file.available ? { state: 'pending' } : { state: 'unavailable', reason: file.unavailableReason ?? 'Formato ainda não disponível.' };
      }
      setJob({ key: jobKey, plan, progress });
      const batch = { key: jobKey, files: new Map<string, BuiltFile>(), manifestAttempt: 0 };
      prepared.current = batch;
      const buildable = plan.files.filter((file) => file.available);
      const order = [...buildable.filter((file) => file.kind !== 'manifest'), ...buildable.filter((file) => file.kind === 'manifest')];
      for (const file of order) {
        if (!live) return;
        patch(jobKey, file.fileName, { state: 'building' });
        const manifestAttempt = file.kind === 'manifest' ? ++batch.manifestAttempt : undefined;
        const built = await commands.export.buildFile({ ...request, fileName: file.fileName, simulation: round.simulation,
          ...(file.kind === 'manifest' ? { prepared: [...batch.files.values()] } : {}) });
        if (!live) return;
        if (manifestAttempt && manifestAttempt !== batch.manifestAttempt) continue;
        if (built.ok) batch.files.set(file.fileName, built.value);
        patch(
          jobKey,
          file.fileName,
          built.ok ? fromBuilt(built.value) : { state: 'failed', error: { code: built.refusal.code, message: built.refusal.message } },
        );
      }
    })();
    return () => {
      live = false;
      if (prepared.current?.key === jobKey) prepared.current = undefined;
    };
  }, [commands, jobKey, patch, productionId, round.simulation, target.selection]);

  const current = job.key === jobKey ? job : undefined;
  const progress = current?.progress ?? EMPTY;
  const entries = Object.values(progress);
  const buildable = entries.filter((entry) => entry.state !== 'unavailable');
  const done = buildable.filter((entry) => entry.state === 'ready' || entry.state === 'failed').length;
  const state: PackageState = {
    status: !jobKey ? 'idle' : current?.refusal ? 'refused' : current?.plan && done === buildable.length ? 'ready' : 'preparing',
    plan: current?.plan,
    progress,
    refusal: current?.refusal,
    done,
    total: current?.plan ? buildable.length : 0,
    failed: entries.filter((entry) => entry.state === 'failed').length,
    bytes: entries.reduce((sum, entry) => sum + (entry.state === 'ready' ? (entry.bytes ?? 0) : 0), 0),
  };

  /** Rebuilds one file ("Tentar de novo"); resolves true when it is ready, rendered and linked. */
  const retry = useCallback(
    async (fileName: string): Promise<boolean> => {
      const exact = target.selection;
      const batch = prepared.current;
      if (!jobKey || !exact || batch?.key !== jobKey) return false;
      patch(jobKey, fileName, { state: 'building' });
      const request = { productionId, selection: [...exact] };
      const manifestName = current?.plan?.files.find(file => file.kind === 'manifest')?.fileName;
      const manifestAttempt = fileName === manifestName ? ++batch.manifestAttempt : undefined;
      const built = await commands.export.buildFile({ ...request, fileName,
        ...(fileName === manifestName ? { prepared: [...batch.files.values()] } : {}) });
      if (prepared.current !== batch) return false;
      if (manifestAttempt && manifestAttempt !== batch.manifestAttempt) return false;
      if (built.ok) batch.files.set(fileName, built.value);
      const next: FileProgress = built.ok ? fromBuilt(built.value) : { state: 'failed', error: { code: built.refusal.code, message: built.refusal.message } };
      if (manifestName && fileName !== manifestName) {
        patch(jobKey, manifestName, { state: 'building' });
        const attempt = ++batch.manifestAttempt;
        const manifest = await commands.export.buildFile({ ...request, fileName: manifestName, prepared: [...batch.files.values()] });
        if (prepared.current !== batch) return false;
        if (attempt === batch.manifestAttempt) patch(jobKey, manifestName, manifest.ok ? fromBuilt(manifest.value)
          : { state: 'failed', error: { code: manifest.refusal.code, message: manifest.refusal.message } });
      }
      // Rendered now, so the row's download link exists right after this call.
      flushSync(() => patch(jobKey, fileName, next));
      return next.state === 'ready';
    },
    [commands, current?.plan, jobKey, patch, productionId, target.selection],
  );

  /** Builds the whole package again; `simulation` arms a failure for the local adapter. */
  const prepareAgain = useCallback((simulation?: string) => setRound((previous) => ({ n: previous.n + 1, simulation })), []);

  /** Ref callback for a row's download link. */
  const anchorRef = useCallback(
    (fileName: string) => (node: HTMLAnchorElement | null) => {
      if (node) anchors.current.set(fileName, node);
      else anchors.current.delete(fileName);
    },
    [],
  );

  /** Saves files through their rendered links, one after the other (the browser asks once). */
  const isCurrent = useCallback(() => Boolean(jobKey && prepared.current?.key === jobKey), [jobKey]);
  const download = useCallback(async (fileNames: readonly string[]): Promise<string[]> => {
    const batch = prepared.current;
    if (!batch || batch.key !== jobKey) return [];
    const saved: string[] = [];
    for (const fileName of fileNames) {
      if (saved.length > 0) await wait(DOWNLOAD_GAP_MS);
      if (prepared.current !== batch) break;
      const anchor = anchors.current.get(fileName);
      if (!anchor?.isConnected) continue;
      anchor.click();
      saved.push(fileName);
    }
    return saved;
  }, [jobKey]);

  return { ...state, selection: target.selection, retry, prepareAgain, anchorRef, download, isCurrent };
}

export type PackageController = ReturnType<typeof usePackage>;
