import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHttpWorkspaceAdministration} from './workspace-management.ts';

test('a member-view administration port allows reads and refuses mutation before transport',async()=>{
  const calls:string[]=[];
  const port=createHttpWorkspaceAdministration({scope:()=>'workspace',readOnly:()=>true,transport:{
    async request<T>(path:string):Promise<T>{calls.push(path);return {} as T;},
    async upload<T>():Promise<T>{throw new Error('A read-only view cannot upload');},
  }});
  assert.equal(port.readOnly,true);
  assert.equal((await port.templates('workspace')).ok,true);
  assert.equal((await port.saveTemplates({workspaceId:'workspace',revision:1,config:{publication:'Client',presets:['editorial'],defaultPreset:'editorial',font:'Inter'}})).ok,false);
  assert.equal((await port.uploadLogo('workspace',new Blob(['logo']))).ok,false);
  assert.equal((await port.invite({workspaceId:'workspace',name:'Member',email:'member@example.test',role:'editor'})).ok,false);
  assert.equal((await port.members('other')).ok,false);
  assert.deepEqual(calls,['/templates']);
});
