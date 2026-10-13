'use client';

/**
 * Focus mode left the product (D2): inside a production the app menu is already gone and the
 * studio is the document, with at most one panel, closed by default. `useFocusMode()` stays a
 * no-op so screens that still read it keep compiling; the integrator removes the callers at I2.
 */

export type FocusMode = {
  focus: boolean;
  setFocus: (focus: boolean) => void;
  toggle: () => void;
};

const OFF: FocusMode = { focus: false, setFocus: () => undefined, toggle: () => undefined };

/** @deprecated Always off (D2). Removed at I2. */
export function useFocusMode(): FocusMode {
  return OFF;
}
