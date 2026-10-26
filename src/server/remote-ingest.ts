import 'server-only';
import { withWorkspaceWork } from './worker-dispatch.ts';
import { Readable,Transform } from 'node:stream';
import { PutObjectCommand,S3Client } from '@aws-sdk/client-s3';
import { transaction } from './database.ts';
import { remoteResponse } from './storage.ts';
import { finalizeUploadedObject } from './cloud-storage.ts';
import { FlowError,logEvent,safeCode } from './errors.ts';

/** A pending source is the durable import job; expired leases resume after an isolate restart. */
export async function runRemoteIngest(owner:string,signal:AbortSignal) {
  return withWorkspaceWork('remote',owner,signal, scoped => runScoped(owner, scoped));
}

async function runScoped(owner:string,signal:AbortSignal) {
  const source=(await transaction('worker',async db=>(await db.query('SELECT public.reporter_remote_link_claim($1) AS value',[owner])).rows[0]?.value)) as null|{id:string;url:string;key:string;size:number;content_type:string};
  if (!source) return false;
  try {
    const response=await remoteResponse(source.url,signal);let size=0;
    const body=Readable.fromWeb(response.body as never).pipe(new Transform({transform(chunk,_encoding,callback){size+=chunk.length;callback(size>Number(source.size)?new FlowError('SOURCE_CHANGED',422):null,chunk);}}));
    const client=new S3Client({forcePathStyle:true});
    try {await client.send(new PutObjectCommand({Bucket:'reporter-source-media',Key:source.key,Body:body,ContentLength:Number(source.size),ContentType:source.content_type}),{abortSignal:signal});}
    finally{client.destroy();body.destroy();}
    if(size!==Number(source.size))throw new FlowError('SOURCE_CHANGED',422);
    await finalizeUploadedObject('reporter-source-media',source.key);
  } catch(error) {
    const code=safeCode(error);logEvent('worker','remote_import_failed',{error_code:code});
    await transaction('worker',async db=>{await db.query('SELECT public.reporter_remote_link_failed($1,$2,$3)',[source.id,owner,code]);});
  }
  return true;
}
