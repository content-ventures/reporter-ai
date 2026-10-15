import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

// The repository is public, so are its workflow logs: hide pulled connection strings, storage
// keys, the worker URL and their hosts before any later step could print them.
const SENSITIVE = /^(?:AWS_|NEON_FUNCTION_|NEON_AUTH_|DATABASE_URL|PG|POSTGRES|REPORTER_.*(?:URL|PASSWORD))/;

export function masks(values) {
  const hidden = new Set();
  for (const value of values) {
    if (!value) continue;
    hidden.add(value);
    try { const { hostname } = new URL(value); if (hostname) hidden.add(hostname); } catch { /* not a URL */ }
  }
  return [...hidden].map(value => `::add-mask::${value}`);
}

if (import.meta.main) {
  const [first, ...rest] = process.argv.slice(2);
  // `--value <secret>` masks one value; otherwise each argument is an env file to scan.
  const values = first === '--value' ? rest : [first, ...rest].flatMap(file =>
    Object.entries(parseEnv(readFileSync(file, 'utf8'))).filter(([name]) => SENSITIVE.test(name)).map(([, value]) => value));
  for (const line of masks(values)) console.log(line);
}
