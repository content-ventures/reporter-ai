import { setTimeout as delay } from 'node:timers/promises';

const sourceRevision=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value)?value:value===undefined?'missing':'invalid';

/** Deployment completion can precede the function route becoming reachable. */
export async function waitForWorkerReadiness(endpoint,secret,{attempts=18,sleep=delay,request=fetch,expectedCommit}={}){
  let code='WORKER_UNAVAILABLE';
  for(let attempt=0;attempt<attempts;attempt++){
    try{
      const response=await request(endpoint,{headers:{'x-reporter-worker-key':secret},signal:AbortSignal.timeout(120000)});
      const payload=await response.json().catch(()=>({}));
      if(response.ok&&payload.ok===true){
        if(!expectedCommit||payload.sourceCommit===expectedCommit)return;
        code='WORKER_SOURCE_MISMATCH';
        console.log(`Worker source expected=${sourceRevision(expectedCommit)} actual=${sourceRevision(payload.sourceCommit)}`);
      }else code=typeof payload.error==='string'&&/^[A-Z0-9_]{1,64}$/.test(payload.error)?payload.error:`HTTP_${response.status}`;
    }catch{code='WORKER_UNREACHABLE';}
    console.log(`Worker readiness ${attempt+1}/${attempts}: ${code}`);
    if(attempt+1<attempts)await sleep(5000);
  }
  throw new Error(`Worker readiness failed: ${code}`);
}
