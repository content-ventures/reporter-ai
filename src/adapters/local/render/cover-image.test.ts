import {test} from 'node:test';
import assert from 'node:assert/strict';
import {servedCoverLoader} from './cover-image.ts';
test('decoded images and late answers are released when their client context closes',async()=>{
  let released=0,complete!:(image:{source:{close:()=>void};width:number;height:number})=>void;
  const image={source:{close:()=>{released++;}},width:1,height:1};
  const loader=servedCoverLoader('/private-client-image',{fetchBlob:async()=>new Blob(),decode:()=>new Promise(resolve=>{complete=resolve;})});
  const late=loader();await new Promise(resolve=>setImmediate(resolve));loader.dispose();complete(image);
  assert.equal((await late).ok,false);assert.equal(released,1);assert.equal((await loader()).ok,false);
  const cached=servedCoverLoader('/second-client-image',{fetchBlob:async()=>new Blob(),decode:async()=>image});
  assert.equal((await cached()).ok,true);cached.dispose();await new Promise(resolve=>setImmediate(resolve));assert.equal(released,2);
});
