import type { ThemeMode } from '@content-ventures/design-system/v3';

export const APPEARANCE_COOKIE = 'reporter-appearance';
export const APPEARANCE_STORAGE = 'reporter:appearance';

export function appearanceMode(value: unknown): ThemeMode | undefined {
  return value === 'light' || value === 'dark' || value === 'system' ? value : undefined;
}
