import 'server-only';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  GetBucketCorsCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { z } from 'zod';
import { MAX_UPLOAD_BYTES } from '../domain/reporter.ts';
import { transaction } from './database.ts';
import { FlowError } from './errors.ts';
import { appOrigins } from './worker-config.ts';

export const SOURCE_BUCKET = 'reporter-source-media';
export const MULTIPART_PART_BYTES = 16 * 1024 ** 2;
const UPLOAD_URL_TTL_SECONDS = 6 * 60 * 60;
const SOURCE_URL_TTL_SECONDS = 60 * 60;
const MAX_PARTS = Math.ceil(MAX_UPLOAD_BYTES / MULTIPART_PART_BYTES);

const uploadInputSchema = z.object({
  source_id: z.string().uuid(),
  bucket: z.literal(SOURCE_BUCKET),
  key: z.string().regex(/^incoming\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:mp3|mp4|m4a|wav|ogg|flac|webm)$/i),
  size: z.union([z.string(),z.number()]).transform(Number).pipe(z.number().int().min(1).max(MAX_UPLOAD_BYTES)),
  content_type: z.enum(['audio/mpeg','audio/mp4','audio/wav','audio/ogg','audio/flac','audio/webm','video/mp4','video/webm']),
  file_name: z.string().min(1).max(255),
  upload_id: z.string().min(8).max(1024).nullable().optional(),
});

let client: S3Client | undefined;
let corsConfigured: Promise<void> | undefined;
function s3() {
  client ??= new S3Client({ forcePathStyle: true,requestChecksumCalculation: 'WHEN_REQUIRED' });
  return client;
}

function allowedOrigins() {
  const origins = appOrigins();
  if (!origins.length) throw new FlowError('UPLOAD_CONFIGURATION',503);
  return origins;
}

async function ensureUploadCors() {
  corsConfigured ??= s3().send(new GetBucketCorsCommand({ Bucket: SOURCE_BUCKET })).then(result => {
    // Every configured app origin must be able to PUT parts and read their ETag.
    for(const origin of allowedOrigins())
      if(!result.CORSRules?.some(rule=>rule.AllowedOrigins?.includes(origin)&&rule.AllowedMethods?.includes('PUT')&&rule.AllowedHeaders?.includes('*')&&rule.ExposeHeaders?.some(header=>header.toLowerCase()==='etag')))
        throw new FlowError('UPLOAD_CONFIGURATION',503);
  }).catch(error => {
    corsConfigured = undefined;
    throw error;
  });
  await corsConfigured;
}

export async function checkUploadStorage() {
  // The same permission and origin configuration used by /uploads/start.
  await ensureUploadCors();
}

async function authorizedUpload(sourceId: string,token: string) {
  return uploadInputSchema.parse(await transaction('worker',async db => (await db.query(
    'SELECT public.reporter_cloud_upload_input($1,$2) AS value',[sourceId,token],
  )).rows[0]?.value));
}

export async function startCloudUpload(sourceId: string,token: string) {
  const input = await authorizedUpload(sourceId,token);
  await ensureUploadCors();
  let uploadId = input.upload_id ?? undefined;
  if (!uploadId) {
    const created = await s3().send(new CreateMultipartUploadCommand({
      Bucket: input.bucket,Key: input.key,ContentType: input.content_type,
      Metadata: { source_id: input.source_id },
    }));
    uploadId = created.UploadId;
    if (!uploadId) throw new FlowError('UPLOAD_SESSION_FAILED',503,true,5);
    try {
      await transaction('worker',async db => { await db.query(
        'SELECT public.reporter_cloud_upload_set_id($1,$2,$3)',[input.source_id,token,uploadId],
      ); });
    } catch (error) {
      // A racing retry may have persisted another upload id. Re-read the
      // authoritative session instead of exposing two resumable uploads.
      const current = await authorizedUpload(sourceId,token);
      if (!current.upload_id) throw error;
      if (current.upload_id!==uploadId) await s3().send(new AbortMultipartUploadCommand({
        Bucket: input.bucket,Key: input.key,UploadId: uploadId,
      })).catch(() => {});
      uploadId = current.upload_id;
    }
  }
  const count = Math.ceil(input.size/MULTIPART_PART_BYTES);
  if (count<1 || count>MAX_PARTS) throw new FlowError('FILE_TOO_LARGE',413);
  const parts = await Promise.all(Array.from({ length: count },async (_,index) => ({
    number: index+1,
    url: await getSignedUrl(s3(),new UploadPartCommand({
      Bucket: input.bucket,Key: input.key,UploadId: uploadId,PartNumber: index+1,
    }),{ expiresIn: UPLOAD_URL_TTL_SECONDS }),
  })));
  return { sourceId: input.source_id,partSize: MULTIPART_PART_BYTES,size: input.size,parts };
}

export async function completeCloudUpload(sourceId: string,token: string) {
  const input = await authorizedUpload(sourceId,token);
  if (!input.upload_id) throw new FlowError('UPLOAD_SESSION_MISSING',409);
  const parts: { ETag: string; PartNumber: number; Size: number }[] = [];
  let marker: string | undefined;
  do {
    const page = await s3().send(new ListPartsCommand({
      Bucket: input.bucket,Key: input.key,UploadId: input.upload_id,PartNumberMarker: marker,
    }));
    for (const part of page.Parts ?? []) {
      if (!part.ETag || !part.PartNumber || !part.Size) throw new FlowError('UPLOAD_INCOMPLETE',409);
      parts.push({ ETag: part.ETag,PartNumber: part.PartNumber,Size: part.Size });
    }
    marker = page.IsTruncated ? page.NextPartNumberMarker : undefined;
  } while (marker);
  const expected = Math.ceil(input.size/MULTIPART_PART_BYTES);
  const uploadedBytes = parts.reduce((total,part,index) => {
    if (part.PartNumber!==index+1) throw new FlowError('UPLOAD_INCOMPLETE',409);
    const expectedSize = Math.min(MULTIPART_PART_BYTES,input.size-index*MULTIPART_PART_BYTES);
    if (part.Size!==expectedSize) throw new FlowError('UPLOAD_INCOMPLETE',409);
    return total + part.Size;
  },0);
  if (parts.length!==expected || uploadedBytes!==input.size) throw new FlowError('UPLOAD_INCOMPLETE',409);
  await s3().send(new CompleteMultipartUploadCommand({
    Bucket: input.bucket,Key: input.key,UploadId: input.upload_id,
    MultipartUpload: { Parts: parts.map(({ ETag,PartNumber }) => ({ ETag,PartNumber })) },
  }));
  // Registering here (idempotent with the storage trigger) queues transcription even if
  // the storage delivery is lost or late.
  await finalizeUploadedObject(input.bucket,input.key);
  return { accepted: true,sourceId: input.source_id };
}

export async function finalizeUploadedObject(bucket: string,key: string) {
  if (bucket!==SOURCE_BUCKET || !key.startsWith('incoming/')) throw new FlowError('UPLOAD_OBJECT_DENIED',403);
  const object = await s3().send(new HeadObjectCommand({ Bucket: bucket,Key: key }));
  const size = object.ContentLength,contentType = object.ContentType,etag = object.ETag;
  if (!size || !contentType || !etag) throw new FlowError('UPLOAD_OBJECT_INVALID',422);
  return transaction('worker',async db => (await db.query(
    'SELECT public.reporter_complete_cloud_upload($1,$2,$3,$4,$5) AS value',
    [bucket,key,size,contentType,etag],
  )).rows[0]?.value);
}

export async function signedSourceUrl(bucket: string,key: string) {
  if (bucket!==SOURCE_BUCKET || !key.startsWith('incoming/')) throw new FlowError('SOURCE_UNAVAILABLE',422);
  return getSignedUrl(s3(),new GetObjectCommand({ Bucket: bucket,Key: key }),{ expiresIn: SOURCE_URL_TTL_SECONDS });
}
