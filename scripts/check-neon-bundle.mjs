import { zipFunctionBundle } from '@neon/config-runtime/v1';

// Config evaluation requires env values, but building the function neither
// connects to services nor needs deployment credentials.
for (const name of ['REPORTER_WORKER_PASSWORD', 'GROQ_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'PIXABAY_API_KEY']) {
  process.env[name] = 'bundle-validation-only';
}
process.env.DATABASE_URL = 'postgresql://owner:placeholder@localhost/test';
process.env.REPORTER_APP_ORIGINS = 'https://reporter.invalid';
const { bundleWorker } = await import('../neon.ts');
const entries = await bundleWorker({ slug: 'reporterworker', source: './functions/reporter-worker.ts' });
const zip = await zipFunctionBundle('reporterworker', entries);
console.log(`Neon worker bundle validated: ${Object.keys(entries).length} files, ${zip.length} compressed bytes.`);
