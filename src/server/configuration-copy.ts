import 'server-only';
import {createHmac,timingSafeEqual} from 'node:crypto';
import type {PoolClient} from 'pg';
import {z} from 'zod';
import {CONFIGURATION_COPY_FIELDS,configurationStamp,proposeConfigurationCopy} from '../domain/configuration-copy.ts';
import type {ConfigurationCopyField,ConfigurationCopyPreview,ConfigurationSnapshot} from '../domain/configuration-copy.ts';
import {defaultPipelineDefinition,PIPELINE_MODELS,pipelineRevision,compactFunnels} from '../domain/pipeline.ts';
import {reviseEditorialPolicy} from '../domain/editorial-policy.ts';
import {templateConfigurationHash,validateTemplateConfiguration} from '../domain/workspace-templates.ts';
import {databasePassword} from './config.ts';
import {reporterDeploymentMode} from './deployment.ts';
import {generationModel} from './groq.ts';
import {FlowError} from './errors.ts';
import {parsePipelineDefinition} from './pipeline.ts';

type Pair={source:ConfigurationSnapshot;target:ConfigurationSnapshot};
const fieldsSchema=z.array(z.enum(CONFIGURATION_COPY_FIELDS)).min(1).max(4).refine(fields=>new Set(fields).size===fields.length);
const previewSchema=z.object({sourceId:z.uuid(),targetId:z.uuid(),fields:fieldsSchema}).strict();
const tokenSchema=previewSchema.extend({version:z.literal(1),actor:z.uuid(),sourceStamp:z.string(),targetStamp:z.string(),expires:z.number().int()}).strict();
function refuse(code:string,status:number,message:string):never{const error=new FlowError(code,status);error.reason=message;throw error;}
function signature(payload:string){
  const secret=reporterDeploymentMode()==='local'?databasePassword('worker'):process.env.REPORTER_WORKER_PASSWORD;
  if(!secret)refuse('COPY_UNAVAILABLE',503,'A cópia de configurações não está disponível agora.');
  return createHmac('sha256',secret).update('reporter-configuration-copy-v1\0'+payload).digest();
}
function sign(value:z.infer<typeof tokenSchema>){const payload=Buffer.from(JSON.stringify(value)).toString('base64url');return payload+'.'+signature(payload).toString('base64url');}
function verify(token:string,actor:string){
  const [payload,mac,extra]=token.split('.');
  if(!payload||!mac||extra||token.length>4096)refuse('COPY_INVALID',422,'Gere uma nova prévia antes de copiar.');
  const expected=signature(payload),actual=Buffer.from(mac,'base64url');
  if(actual.toString('base64url')!==mac||actual.length!==expected.length||!timingSafeEqual(actual,expected))refuse('COPY_INVALID',422,'Gere uma nova prévia antes de copiar.');
  let input:unknown;try{input=JSON.parse(Buffer.from(payload,'base64url').toString());}catch{refuse('COPY_INVALID',422,'Gere uma nova prévia antes de copiar.');}
  const parsed=tokenSchema.safeParse(input);
  if(!parsed.success||parsed.data.actor!==actor)refuse('COPY_INVALID',422,'Gere uma nova prévia antes de copiar.');
  if(parsed.data.expires<Date.now())refuse('COPY_EXPIRED',409,'A prévia expirou. Confira novamente antes de copiar.');
  return parsed.data;
}
async function snapshot(client:PoolClient,source:string,target:string):Promise<Pair>{
  return(await client.query('SELECT public.reporter_configuration_snapshot($1,$2) AS value',[source,target])).rows[0].value;
}
function proposal(pair:Pair,fields:ConfigurationCopyField[]){
  const model=generationModel(),defaults=defaultPipelineDefinition(PIPELINE_MODELS.find(known=>known===model)??PIPELINE_MODELS[0]);
  try{return proposeConfigurationCopy(pair.source,pair.target,fields,defaults);}
  catch(error){if((error as Error).message==='COPY_TEMPLATES_UNAVAILABLE')refuse('COPY_TEMPLATES_UNAVAILABLE',422,'O workspace de origem ainda não tem um catálogo configurado para copiar.');throw error;}
}
export async function previewConfigurationCopy(client:PoolClient,actor:string,body:unknown):Promise<ConfigurationCopyPreview>{
  const parsed=previewSchema.safeParse(body);if(!parsed.success)refuse('COPY_INVALID',422,'Escolha a origem, o destino e os campos.');
  const {sourceId,targetId,fields}=parsed.data,pair=await snapshot(client,sourceId,targetId),plan=proposal(pair,fields),expires=Date.now()+5*60_000;
  return{source:{id:sourceId,name:pair.source.workspace.name},target:{id:targetId,name:pair.target.workspace.name},changes:plan.changes,
    expiresAt:new Date(expires).toISOString(),token:sign({...parsed.data,version:1,actor,sourceStamp:configurationStamp(pair.source),targetStamp:configurationStamp(pair.target),expires})};
}
export async function applyConfigurationCopy(client:PoolClient,actor:string,body:unknown):Promise<{workspace:ConfigurationSnapshot['workspace']}>{
  const parsed=z.object({token:z.string().max(4096)}).strict().safeParse(body);if(!parsed.success)refuse('COPY_INVALID',422,'Gere uma prévia antes de copiar.');
  const token=verify(parsed.data.token,actor),pair=await snapshot(client,token.sourceId,token.targetId);
  if(configurationStamp(pair.source)!==token.sourceStamp||configurationStamp(pair.target)!==token.targetStamp)refuse('COPY_CONFLICT',409,'A origem ou o destino mudou. Confira uma nova prévia.');
  const plan=proposal(pair,token.fields),now=new Date().toISOString();
  let pipeline=null;
  if(token.fields.some(field=>field!=='templates')){
    const policy=reviseEditorialPolicy(pair.target.pipeline?.definition.editorial,plan.definition.editorial,{at:now,by:actor});
    if(policy)plan.definition.editorial=policy;else delete plan.definition.editorial;
    const checked=parsePipelineDefinition(plan.definition);if(!checked.definition)refuse('COPY_INVALID',422,checked.error!);
    pipeline=pipelineRevision(compactFunnels(checked.definition),(pair.target.pipeline?.revision??1)+1,now);
  }
  if(plan.templates){const checked=validateTemplateConfiguration(plan.templates);if(!checked.ok)refuse('COPY_INVALID',422,checked.refusal.message);plan.templates=checked.value;}
  const value=(await client.query('SELECT public.reporter_configuration_apply($1,$2,$3,$4,$5,$6,$7) AS value',[
    token.sourceId,token.targetId,JSON.stringify(pair),JSON.stringify(token.fields),pipeline?JSON.stringify(pipeline):null,
    plan.templates?templateConfigurationHash(token.targetId,plan.templates):null,plan.templates?JSON.stringify(plan.templates):null,
  ])).rows[0].value as Pair;
  return{workspace:value.target.workspace};
}
