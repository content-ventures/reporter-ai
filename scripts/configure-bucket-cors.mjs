import { GetBucketCorsCommand, PutBucketCorsCommand, S3Client } from '@aws-sdk/client-s3';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SOURCE_BUCKET = 'reporter-source-media';

/** Browsers only PUT upload parts and read their ETag; completion and reads go through the server. */
export function uploadCorsRules(origins) {
  return [{ ID: 'reporter-browser-uploads', AllowedOrigins: [...origins].sort(), AllowedMethods: ['PUT'], AllowedHeaders: ['*'],
    ExposeHeaders: ['ETag'], MaxAgeSeconds: 3600 }];
}

/** The same test the worker's readiness applies (src/server/cloud-storage.ts). */
export function corsAllows(rules, origins) {
  return origins.every(origin => rules.some(rule => rule.AllowedOrigins?.includes(origin) && rule.AllowedMethods?.includes('PUT')
    && rule.AllowedHeaders?.includes('*') && rule.ExposeHeaders?.some(header => header.toLowerCase() === 'etag')));
}

const canonical = rules => JSON.stringify(rules.map(rule => ({ ...rule, AllowedOrigins: [...(rule.AllowedOrigins ?? [])].sort() })));

/** Writes the upload CORS only when it differs, so a release can run it every time. */
export async function configureBucketCors(client, origins, bucket = SOURCE_BUCKET) {
  if (!origins.length) throw new Error('REPORTER_APP_ORIGINS lists no origin.');
  for (const origin of origins) if (new URL(origin).origin !== origin) throw new Error(`Not an origin: ${origin}`);
  let current = [];
  try { current = (await client.send(new GetBucketCorsCommand({ Bucket: bucket }))).CORSRules ?? []; }
  catch (error) { if (error?.name !== 'NoSuchCORSConfiguration') throw error; }
  const wanted = uploadCorsRules(origins);
  if (corsAllows(current, origins) && canonical(current) === canonical(wanted)) return 'unchanged';
  await client.send(new PutBucketCorsCommand({ Bucket: bucket, CORSConfiguration: { CORSRules: wanted } }));
  return 'updated';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const origins = [...new Set((process.env.REPORTER_APP_ORIGINS ?? '').split(',').map(entry => entry.trim()).filter(Boolean))];
  const client = new S3Client({ forcePathStyle: true, requestChecksumCalculation: 'WHEN_REQUIRED' });
  try {
    const outcome = await configureBucketCors(client, origins);
    console.log(`Upload CORS ${outcome} for ${origins.length} app origin(s).`);
  } catch (error) { console.error(`Upload CORS could not be configured: ${error.message}`); process.exitCode = 1; }
  finally { client.destroy(); }
}
