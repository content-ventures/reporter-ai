import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

// The repository is public, so are its workflow logs: hide pulled connection strings, storage
// keys and the worker URL before any later step could print them.
const SENSITIVE = /^(?:AWS_|NEON_FUNCTION_|NEON_AUTH_|DATABASE_URL|PG|POSTGRES|REPORTER_.*(?:URL|PASSWORD))/;
for (const file of process.argv.slice(2)) {
  for (const [name, value] of Object.entries(parseEnv(readFileSync(file, 'utf8')))) {
    if (SENSITIVE.test(name) && value) console.log(`::add-mask::${value}`);
  }
}
