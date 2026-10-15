import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CLOUD } from './lib/migrations.mjs';

// What would break the previous app or worker while both versions run during a release.
// Replacing code (functions, policies, triggers) and deleting rows inside functions is fine.
const DESTRUCTIVE = [
  [/\bDROP\s+TABLE\b/i, 'drops a table'],
  [/\bDROP\s+SCHEMA\b/i, 'drops a schema'],
  [/\bDROP\s+COLUMN\b/i, 'drops a column'],
  [/\bDROP\s+(?:TYPE|DOMAIN|DATABASE|ROLE|OWNED)\b/i, 'drops a shared object'],
  [/\bTRUNCATE\b/i, 'truncates a table'],
  [/\bALTER\s+TABLE\b[^;]*\bRENAME\b/i, 'renames a table or column'],
  [/\bALTER\s+TABLE\b[^;]*\bALTER\s+COLUMN\b[^;]*\bTYPE\b/i, 'changes a column type'],
];
const ALLOWED = /--\s*reporter:destructive-approved\s+\S/;

/** Destructive statements outside comments; an explicitly approved line is reported, not refused. */
export function migrationProblems(file, sql) {
  const problems = [], approved = [];
  sql.split('\n').forEach((line, index) => {
    const code = line.replace(/--.*$/, '');
    for (const [pattern, reason] of DESTRUCTIVE) {
      if (!pattern.test(code)) continue;
      (ALLOWED.test(line) ? approved : problems).push(`${file}:${index + 1} ${reason}`);
    }
  });
  return { problems, approved };
}

export async function checkMigrations(files = CLOUD, read = path => readFile(resolve(path), 'utf8')) {
  const results = await Promise.all(files.map(async file => migrationProblems(file, await read(file))));
  return { problems: results.flatMap(result => result.problems), approved: results.flatMap(result => result.approved) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { problems, approved } = await checkMigrations();
  for (const line of approved) console.log(`Approved destructive change: ${line}`);
  if (problems.length) { console.error(`Migrations must stay additive during a release:\n- ${problems.join('\n- ')}`); process.exitCode = 1; }
  else console.log(`${CLOUD.length} cloud migrations are additive.`);
}
