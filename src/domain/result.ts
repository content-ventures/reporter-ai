/**
 * Result type shared by every rule. A refusal carries a stable English `code` for logic and
 * tests, plus a pt-BR `message` the UI can show verbatim (Tooltip reason, Alert, toast).
 */

export type Refusal<C extends string = string> = {
  code: C;
  message: string;
  details?: Record<string, unknown>;
};

export type Result<T, C extends string = string> =
  | { ok: true; value: T }
  | { ok: false; refusal: Refusal<C> };

export function ok<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

export function refuse<C extends string>(
  code: C,
  message: string,
  details?: Record<string, unknown>,
): { ok: false; refusal: Refusal<C> } {
  return details === undefined
    ? { ok: false, refusal: { code, message } }
    : { ok: false, refusal: { code, message, details } };
}

/** Context every command-like pure function receives instead of reading time or randomness. */
export type CommandContext = {
  /** Current instant from the Clock port. */
  now: string;
  /** Next id from the IdGenerator port; the prefix keeps ids readable (e.g. `ver`, `dec`). */
  newId: (prefix: string) => string;
  /** Person performing the command. */
  actorId: string;
};
