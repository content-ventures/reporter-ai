import 'server-only';
import {createHash,randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import sharp from 'sharp';
import {z} from 'zod';
import {WORKSPACE_TEMPLATE_FONTS,WORKSPACE_TEMPLATE_PRESETS,templateConfigurationHash,validateTemplateConfiguration} from '../domain/workspace-templates.ts';
import type {WorkspaceBrandAsset,WorkspaceTemplateConfiguration} from '../domain/workspace-templates.ts';
import {workspaceTemplateHash} from '../domain/workspace-templates.ts';
import type {EditorialCheckpoint} from '../ports/connected-workspace.ts';
import {transaction} from './database.ts';
import {FlowError} from './errors.ts';
import {readImageFile,writeImageFile} from './image-storage.ts';
import {currentReporterContext} from './request-context.ts';

export type TemplateExecutor=<T>(operation:(client:PoolClient)=>Promise<T>)=>Promise<T>;
export const templateInputSchema=z.object({revision:z.number().int().positive(),config:z.object({
  publication:z.string().max(80),presets:z.array(z.enum(WORKSPACE_TEMPLATE_PRESETS)).min(1).max(5),defaultPreset:z.enum(WORKSPACE_TEMPLATE_PRESETS),
  font:z.enum(WORKSPACE_TEMPLATE_FONTS),logoId:z.uuid().optional(),
}).strict()}).strict();
const failure=(code:string,status:number,message:string)=>{const error=new FlowError(code,status);error.reason=message;return error;};
function translate(error:unknown):never{
  const {code,message}=error as {code?:string;message?:string};
  if(code==='42501')throw failure('FORBIDDEN',403,'Somente administradores configuram os modelos e a marca deste workspace.');
  if(code==='40001'||code==='40P01'||message==='CONFLICT')throw failure('TEMPLATE_CONFLICT',409,'A configuração mudou em outra sessão. Atualize antes de salvar.');
  if(message==='UNKNOWN_LOGO')throw failure('TEMPLATE_UNKNOWN_LOGO',422,'Escolha uma marca enviada para este workspace.');
  if(message==='INVALID_CONFIGURATION'||code==='22023')throw failure('TEMPLATE_INVALID',422,'Confira o veículo, os modelos e a marca.');
  throw error;
}
export async function readWorkspaceTemplates(client:PoolClient,workspaceId:string,hashes:string[]=[]):Promise<WorkspaceTemplateConfiguration>{
  return (await client.query('SELECT public.reporter_template_configuration($1,$2) AS value',[workspaceId,hashes])).rows[0].value;
}
/** Current drafts come first; older history is also resolvable individually by its owned hash. */
export function referencedTemplateHashes(checkpoint:EditorialCheckpoint):string[]{
  const bodies=checkpoint.state.productions.flatMap(production=>[...production.pieces.map(piece=>piece.draft.body),...production.versions.map(version=>version.body)]);
  return [...new Set(bodies.flatMap(body=>body.type==='carousel'?[workspaceTemplateHash(body.templateId,checkpoint.state.workspace.id)].filter((hash):hash is string=>Boolean(hash)):[]))].slice(0,200);
}
export async function saveWorkspaceTemplates(client:Pick<PoolClient,'query'>,workspaceId:string,body:unknown):Promise<WorkspaceTemplateConfiguration>{
  const parsed=templateInputSchema.safeParse(body);
  if(!parsed.success)throw failure('TEMPLATE_INVALID',422,'Confira o veículo, os modelos e a marca.');
  const checked=validateTemplateConfiguration(parsed.data.config);if(!checked.ok)throw failure('TEMPLATE_INVALID',422,checked.refusal.message);
  try{return (await client.query('SELECT public.reporter_template_save($1,$2,$3,$4) AS value',
    [workspaceId,parsed.data.revision,templateConfigurationHash(workspaceId,checked.value),JSON.stringify(checked.value)])).rows[0].value;}
  catch(error){translate(error);}
}
async function imageBody(request:Request):Promise<Buffer>{
  if(!request.headers.get('content-type')?.startsWith('image/')||!request.body)throw failure('BRAND_IMAGE_INVALID',415,'Envie uma imagem PNG, JPEG ou WebP.');
  const reader=request.body.getReader(),parts:Uint8Array[]=[];let size=0;
  try{
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;
      if(size>2*1024**2){await reader.cancel();throw failure('BRAND_IMAGE_TOO_LARGE',413,'Envie uma imagem de até 2 MB.');}parts.push(value);}
  }finally{reader.releaseLock();}
  if(!size)throw failure('BRAND_IMAGE_INVALID',422,'O arquivo está vazio.');return Buffer.concat(parts);
}
export async function uploadWorkspaceBrand(request:Request,workspaceId:string,execute:TemplateExecutor):Promise<WorkspaceBrandAsset>{
  await execute(async client=>{try{await client.query('SELECT public.reporter_template_authorize($1)',[workspaceId]);}catch(error){translate(error);}});
  const input=await imageBody(request);let bytes:Buffer,width:number,height:number;
  try{
    const image=sharp(input,{limitInputPixels:16_000_000}),metadata=await image.metadata();
    if(!['png','jpeg','webp'].includes(metadata.format??''))throw new Error('INVALID_IMAGE');
    const result=await image.rotate().resize(768,768,{fit:'inside',withoutEnlargement:true}).png().toBuffer({resolveWithObject:true});
    bytes=result.data;width=result.info.width;height=result.info.height;
  }catch{throw failure('BRAND_IMAGE_INVALID',422,'Não foi possível ler essa imagem. Envie PNG, JPEG ou WebP.');}
  const file=createHash('sha256').update(bytes).digest('hex')+'.image';
  await writeImageFile(file,bytes,'image/png',workspaceId);
  return execute(async client=>{try{return (await client.query('SELECT public.reporter_brand_asset_register($1,$2,$3,$4,$5) AS value',
    [workspaceId,randomUUID(),file,width,height])).rows[0].value;}catch(error){translate(error);}});
}
export async function handleWorkspaceTemplates(request:Request,path:string[],readJson:(request:Request)=>Promise<unknown>):Promise<Response>{
  const workspace=currentReporterContext().portal,execute:TemplateExecutor=operation=>transaction('runtime',operation);
  if(request.method==='GET'&&path.length===0){
    const hashes=(new URL(request.url).searchParams.get('hashes')??'').split(',').filter(Boolean);
    if(hashes.length>200||hashes.some(hash=>!/^[a-f0-9]{16}$/.test(hash)))throw new FlowError('INVALID_INPUT',422);
    return Response.json(await execute(client=>readWorkspaceTemplates(client,workspace,hashes)),{headers:{'cache-control':'no-store'}});
  }
  if(request.method==='POST'&&path.length===0){
    const body=await readJson(request);
    return Response.json(await execute(client=>saveWorkspaceTemplates(client,workspace,body)),{headers:{'cache-control':'no-store'}});
  }
  if(request.method==='POST'&&path.join('/')==='logo')return Response.json(await uploadWorkspaceBrand(request,workspace,execute),{status:201,headers:{'cache-control':'no-store'}});
  if(request.method==='GET'&&path.length===2&&path[0]==='logos'&&z.uuid().safeParse(path[1]).success){
    const file=await execute(async client=>(await client.query('SELECT public.reporter_brand_asset_file($1) AS value',[path[1]])).rows[0].value as string|null);
    if(!file)throw new FlowError('NOT_FOUND',404);
    return new Response(new Uint8Array(await readImageFile(file)),{headers:{'content-type':'image/png','cache-control':'private, max-age=300','vary':'Cookie','x-content-type-options':'nosniff'}});
  }
  throw new FlowError('NOT_FOUND',404);
}
