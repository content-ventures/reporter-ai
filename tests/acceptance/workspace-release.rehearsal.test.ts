import assert from 'node:assert/strict';
import test from 'node:test';
import {startWorkspaceScenario} from '../support/workspace-scenario.ts';

test('workspace release QA preserves the pilot, rejects a wrong endpoint and uses no providers',async()=>{
  const scenario=await startWorkspaceScenario({editors:2});
  try{
    // Match the actual managed provider's UUID identity and required columns. An absent
    // provider account must not be accepted just because its core record is verified.
    await scenario.owner(`CREATE SCHEMA neon_auth; CREATE TABLE neon_auth."user"(
      id uuid PRIMARY KEY,name text NOT NULL,email text UNIQUE NOT NULL,"emailVerified" boolean NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
    const {acceptWorkspaceFlow}=await import('../../scripts/neon-workspace-acceptance.mjs');
    const environment={...process.env,REPORTER_ACCEPTANCE_TARGET:'staging',NEON_API_KEY:'synthetic-only',NEON_PROJECT_ID:'synthetic-staging',NEON_BRANCH_ID:'br-staging',DATABASE_URL_UNPOOLED:scenario.db.owner};
    const request=(branch:string)=>async(input:RequestInfo|URL)=>Response.json(String(input).endsWith('/endpoints')
      ?{endpoints:[{host:new URL(scenario.db.owner).hostname,branch_id:branch}]}:{branch:{id:'br-staging',protected:false}});
    await assert.rejects(()=>acceptWorkspaceFlow(environment,request('br-production')),/outside the verified staging branch/);
    assert.equal((await scenario.owner('SELECT count(*)::int AS count FROM neon_auth."user"'))[0].count,0,'a wrong endpoint creates no provider identity');
    await acceptWorkspaceFlow(environment,request('br-staging'));
    assert.deepEqual(scenario.providers.calls,{transcriptions:0,completions:0});
    assert.equal((await scenario.owner("SELECT count(*)::int AS count FROM public.user_roles WHERE role='platform_admin'"))[0].count,1,'synthetic release operator is revoked');
    assert.equal((await scenario.owner('SELECT count(*)::int AS count FROM neon_auth."user"'))[0].count,5,'only the five synthetic provider identities are registered');
  }finally{await scenario.stop();}
});
