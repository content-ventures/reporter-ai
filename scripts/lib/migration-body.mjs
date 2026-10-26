/** Apply the registered, individually wrapped files inside one atomic migration transaction. */
export function migrationBody(source) {
  const match = /^((?:\s|--[^\n]*(?:\n|$))*)BEGIN;([\s\S]*)COMMIT;\s*$/.exec(source);
  if (!match || /^(?:BEGIN|COMMIT|ROLLBACK);\s*$/m.test(match[2])) {
    throw new Error('A registered migration must have exactly one outer BEGIN/COMMIT wrapper');
  }
  return match[1] + match[2];
}
