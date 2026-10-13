/**
 * Shape every data hook returns. `loading` exists only until the first answer; afterwards a
 * refetch keeps showing the current data (no skeleton flash) and swaps it when the new answer
 * differs. `error` may keep the last good data so a screen can stay readable while it offers
 * "Tentar de novo".
 */

export type QueryError = {
  /** Stable code: a port refusal (`not_found`, `restricted`, `unknown_run`…) or `unexpected`. */
  code: string;
  /** pt-BR message for the ErrorState. */
  message: string;
};

export type QueryStatus = 'loading' | 'ready' | 'error';

export type QueryState<T> =
  | { status: 'loading'; data: undefined; error: undefined; retry: () => void }
  | { status: 'ready'; data: T; error: undefined; retry: () => void }
  | { status: 'error'; data: T | undefined; error: QueryError; retry: () => void };

const noop = () => {};

/** Shared snapshot for the server render and for hooks whose runtime is not ready yet. */
export const LOADING: QueryState<never> = Object.freeze({ status: 'loading', data: undefined, error: undefined, retry: noop });

/** A thrown error never reaches the screen as is: it becomes this pt-BR message. */
export const UNEXPECTED_ERROR: QueryError = Object.freeze({ code: 'unexpected', message: 'Não foi possível carregar agora. Tente de novo.' });
