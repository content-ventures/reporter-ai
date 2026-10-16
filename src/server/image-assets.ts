import 'server-only';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import sharp from 'sharp';
import { z } from 'zod';
import type { ImageAsset } from '../domain/asset.ts';
import { editorialTransaction } from './editorial.ts';
import type { EditorialScope } from './editorial-store.ts';
import { currentReporterContext } from './request-context.ts';
import { prepareImageFile, readImageFile, writeImageFile } from './image-storage.ts';
import { FlowError, forbiddenError } from './errors.ts';
import { can } from '../domain/permissions.ts';
import { remoteResponse } from './storage.ts';
import { IMAGE_PROMPT_MAX } from '../domain/image-generation.ts';

const metaSchema = z.object({ productionId: z.string().uuid(),authorized: z.boolean(),credit: z.string().max(500).optional(),note: z.string().max(2000).optional(),
  provenance: z.object({libraryId:z.string().uuid()}).passthrough().optional() }).strict();
const mimeSchema = z.enum(['image/jpeg','image/png','image/webp','image/gif']);
// Seeded database identities are GUIDs without RFC UUID version/variant bits.
// Their signed values must still match the authenticated request context exactly.
const preparedSchema = z.object({ id:z.string().uuid(),fileName:z.string().min(1).max(255),mime:mimeSchema,size:z.number().int().min(1).max(10*1024**2),hash:z.string().regex(/^[a-f0-9]{64}$/),meta:metaSchema,
  /** "Gerar com IA": the description the image was made from (origin `generated`). */
  prompt:z.string().trim().min(1).max(IMAGE_PROMPT_MAX).optional(),actor:z.guid(),portal:z.guid(),expires:z.number() }).strict();
function secret() { const value = process.env.REPORTER_WORKER_PASSWORD;if (!value) throw new FlowError('UPLOAD_CONFIGURATION',503);return value; }
function sign(value:string) { return createHmac('sha256',secret()).update(value).digest('base64url'); }
function token(input:z.infer<typeof preparedSchema>) { const value = Buffer.from(JSON.stringify(input)).toString('base64url');return value+'.'+sign(value); }
function verify(value:string) {
  const [body,signature,...rest] = value.split('.'),expected = sign(body ?? '');
  const left = Buffer.from(signature ?? ''),right = Buffer.from(expected);
  if (rest.length || left.length !== right.length || !timingSafeEqual(left,right)) throw new FlowError('ORIGIN_DENIED',403);
  const input = preparedSchema.parse(JSON.parse(Buffer.from(body,'base64url').toString('utf8'))),context = currentReporterContext();
  if (input.expires < Date.now() || input.actor !== context.actor || input.portal !== context.portal) throw new FlowError('ORIGIN_DENIED',403);
  return input;
}
// Asset commands read the production header and the named rows, never the article or transcript.
const assetScope = (productionId: string | undefined, items: EditorialScope['items']): EditorialScope => ({
  productions: productionId ? [productionId] : [],parts: [],sources: 'none',runs: 'none',pipelines: false,items });
async function authorize(productionId:string) {
  return (await editorialTransaction('runtime',async (checkpoint,engine) => {
    const member = checkpoint.state.members.find(member => member.personId === checkpoint.state.sessionPersonId);
    if (!can(member,'piece.edit')) throw forbiddenError('piece.edit');
    const record = engine.records.record(productionId);if (!record) throw new FlowError('NOT_FOUND',404);
    return checkpoint.visuals?.images ?? [];
  },false,'reporter.edit',assetScope(productionId,{ library_image: 'all' }))).value;
}
async function saveAsset(input:{id:string;fileName:string;meta:z.infer<typeof metaSchema>},fileKey:string,bytes:Buffer,origin?:ImageAsset['origin']) {
  const decoded = await sharp(bytes,{limitInputPixels:40000000}).metadata();
  const mime = mimeSchema.parse(decoded.format === 'jpeg' ? 'image/jpeg' : 'image/'+decoded.format);
  if (!decoded.width || !decoded.height) throw new FlowError('INVALID_MEDIA',422);
  const context = currentReporterContext();
  return (await editorialTransaction('runtime',async (_checkpoint,engine) => {
    if (!engine.records.record(input.meta.productionId)) throw new FlowError('NOT_FOUND',404);
    const existing = _checkpoint.imageAssets?.find(entry => entry.asset.id === input.id);if (existing) return existing.asset;
    const asset:ImageAsset = {id:input.id,workspaceId:context.portal,kind:'image',origin:origin ?? {type:'upload',fileName:input.fileName},mime,width:decoded.width,height:decoded.height,bytes:bytes.length,
      rights:{authorized:input.meta.authorized,...(input.meta.note?{note:input.meta.note}:{})},credit:input.meta.credit,createdAt:new Date().toISOString(),createdBy:context.actor};
    const image = input.meta.provenance && _checkpoint.visuals?.images.find(image => image.id === input.meta.provenance?.libraryId);
    if (image) asset.provenance = {...image,libraryId:image.id};
    _checkpoint.imageAssets = [...(_checkpoint.imageAssets ?? []),{productionId:input.meta.productionId,asset,fileKey}];
    return asset;
  },true,'reporter.edit',assetScope(input.meta.productionId,{ image_asset: [input.id],
    library_image: input.meta.provenance ? [input.meta.provenance.libraryId] : [] }))).value;
}
export async function prepareAssetUpload(value:unknown) {
  const input = preparedSchema.omit({actor:true,portal:true,expires:true}).parse(value);await authorize(input.meta.productionId);
  const context = currentReporterContext();
  return {url:await prepareImageFile(input.hash+'.image',input.mime),token:token({...input,actor:context.actor,portal:context.portal,expires:Date.now()+5*60*1000})};
}
export async function completeAssetUpload(value:unknown) {
  const input = verify(z.object({token:z.string().max(12000)}).strict().parse(value).token);await authorize(input.meta.productionId);
  const fileKey = input.hash+'.image',bytes = await readImageFile(fileKey);
  if (bytes.length !== input.size) throw new FlowError('SOURCE_CHANGED',422);
  return saveAsset(input,fileKey,bytes,input.prompt ? {type:'generated',prompt:input.prompt} : undefined);
}
export async function importLinkedAsset(value:unknown,signal:AbortSignal) {
  const input = z.object({url:z.string().url().max(2000),meta:metaSchema}).strict().parse(value);
  const library = await authorize(input.meta.productionId),known = library.find(image => image.id === input.meta.provenance?.libraryId);
  let bytes:Buffer,fileKey:string;
  if (known) {fileKey=known.fileKey;bytes=await readImageFile(fileKey);}
  else {
    const response = await remoteResponse(input.url,AbortSignal.any([signal,AbortSignal.timeout(20000)]));
    const reader=response.body!.getReader(),chunks:Uint8Array[]=[];let size=0;
    try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>10*1024**2){await reader.cancel();throw new FlowError('IMAGE_TOO_LARGE',422);}chunks.push(value);}}finally{reader.releaseLock();}
    bytes=Buffer.concat(chunks);const decoded=await sharp(bytes,{limitInputPixels:40000000}).metadata();
    const mime=mimeSchema.parse(decoded.format==='jpeg'?'image/jpeg':'image/'+decoded.format);
    fileKey=createHash('sha256').update(bytes).digest('hex')+'.image';await writeImageFile(fileKey,bytes,mime);
  }
  return saveAsset({id:randomUUID(),fileName:'imagem',meta:input.meta},fileKey,bytes,{type:'url',url:input.url});
}
export async function uploadedAssetFile(id:string) {
  const entry=(await editorialTransaction('runtime',async checkpoint=>checkpoint.imageAssets?.find(entry=>entry.asset.id===id),false,
    'reporter.edit',assetScope(undefined,{ image_asset: [id] }))).value;
  if (!entry?.fileKey) throw new FlowError('IMAGE_UNAVAILABLE',404);
  return {bytes:await readImageFile(entry.fileKey),mime:entry.asset.mime??'image/jpeg'};
}
