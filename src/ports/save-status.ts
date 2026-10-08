import type { IsoDateTime } from '../domain/ids.ts';
import type { Result } from '../domain/result.ts';
import type { Unsubscribe } from './common.ts';

/**
 * Honest save status for the studio ActionBar ("Salvo neste navegador", or an error with
 * "Tentar de novo"). Local: localStorage writes, quota errors included. Remote: server acks.
 */

export type SaveScope = 'local' | 'memory' | 'remote';

export type SaveErrorCode = 'quota' | 'unavailable' | 'unknown';

export type SaveState = {
  status: 'idle' | 'saving' | 'saved' | 'error';
  scope: SaveScope;
  savedAt?: IsoDateTime;
  error?: { code: SaveErrorCode; message: string };
};

export interface SaveStatusPort {
  /** Synchronous snapshot (suits useSyncExternalStore). */
  current(): SaveState;
  /** Writes everything again; resolves with the new state. */
  retry(): Promise<Result<SaveState, 'save_failed'>>;
  subscribe(listener: (state: SaveState) => void): Unsubscribe;
}
