import test from 'node:test';
import assert from 'node:assert/strict';
import { workerImageObject } from '../src/server/image-storage.ts';

test('browser PUT URLs accept nonempty image bytes and cannot address another portal',async()=>{
  const values={AWS_ACCESS_KEY_ID:'acceptance-placeholder',AWS_SECRET_ACCESS_KEY:'acceptance-placeholder',AWS_REGION:'us-east-1',AWS_ENDPOINT_URL_S3:'https://s3.example.invalid'};
  const previous=Object.fromEntries(Object.keys(values).map(key=>[key,process.env[key]]));Object.assign(process.env,values);
  try{
    const result=await workerImageObject({action:'prepare',key:'images/10000000-0000-0000-0000-000000000101/'+'a'.repeat(64)+'.image',mime:'image/png'});
    assert.ok(result.url);const url=new URL(result.url);
    assert.equal(url.searchParams.has('x-amz-checksum-crc32'),false,'A signature for the empty payload would reject the uploaded image');
    await assert.rejects(()=>workerImageObject({action:'prepare',key:'images/20000000-0000-0000-0000-000000000101/'+'a'.repeat(64)+'.image',mime:'image/png'}),/UNSAFE_STORAGE/);
  }finally{for(const[key,value]of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;}
});
