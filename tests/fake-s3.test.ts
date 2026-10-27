import assert from 'node:assert/strict';
import {test} from 'node:test';
import {startFakeS3} from './support/fake-s3.ts';

test('the synthetic storage implements its declared browser PUT CORS boundary',async()=>{
  const storage=await startFakeS3({bucket:'synthetic',corsOrigins:['http://127.0.0.1:3042']});
  try{
    const url=storage.endpoint+'/synthetic/photo.png',origin='http://127.0.0.1:3042';
    const allowed=await fetch(url,{method:'OPTIONS',headers:{origin,'access-control-request-method':'PUT','access-control-request-headers':'content-type'}});
    assert.equal(allowed.status,204);assert.equal(allowed.headers.get('access-control-allow-origin'),origin);
    const stored=await fetch(url,{method:'PUT',headers:{origin,'content-type':'image/png'},body:'synthetic bytes'});
    assert.equal(stored.status,200);assert.equal(stored.headers.get('access-control-allow-origin'),origin);assert.equal(stored.headers.get('access-control-expose-headers'),'ETag');
    const denied=await fetch(url,{method:'OPTIONS',headers:{origin:'https://foreign.invalid','access-control-request-method':'PUT'}});
    assert.equal(denied.status,403);assert.equal(denied.headers.get('access-control-allow-origin'),null);
  }finally{await storage.stop();}
});
