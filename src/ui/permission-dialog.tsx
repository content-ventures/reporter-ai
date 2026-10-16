'use client';

import { useSyncExternalStore } from 'react';
import { ConfirmDialog, toast } from '@content-ventures/design-system/v3';
import { FORBIDDEN_TITLE, PERMISSION_REFUSALS, type Refusal } from '@/domain';

/**
 * One popup for every permission limit ("Você não tem permissão para isso" + who can), never red
 * text. Only actions the person started call `notifyRefusal`; background saves never do.
 */

let notice: string | null = null;
const listeners = new Set<() => void>();

function publish(next: string | null) {
  notice = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isPermissionRefusal(refusal: Pick<Refusal, 'code'> | undefined): boolean {
  return refusal !== undefined && PERMISSION_REFUSALS.has(refusal.code);
}

/**
 * A refused action: a permission refusal opens the dialog; any other one toasts `title` with the
 * reason (or the reason alone).
 */
export function notifyRefusal(title: string | undefined, refusal: Pick<Refusal, 'code' | 'message'>): void {
  if (isPermissionRefusal(refusal)) {
    publish(refusal.message);
    return;
  }
  if (title) toast(title, { tone: 'error', description: refusal.message });
  else toast(refusal.message, { tone: 'error' });
}

/** A thrown server error (prompts, library, citations): FORBIDDEN is a permission refusal. */
export function refusalOf(error: unknown, fallback: string): Refusal {
  const code = typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : '';
  const message = error instanceof Error ? error.message : fallback;
  return { code: code === 'FORBIDDEN' || code === '42501' ? 'forbidden' : 'failed', message };
}

/** Mounted once by the workspace shell. */
export function PermissionDialogHost() {
  const message = useSyncExternalStore(subscribe, () => notice, () => null);
  // The server's generic text repeats the title: then the title stands alone.
  const description = message && message.replace(/\.$/, '') !== FORBIDDEN_TITLE ? message : undefined;
  return <ConfirmDialog acknowledge open={message !== null} onClose={() => publish(null)} title={FORBIDDEN_TITLE} description={description} />;
}
