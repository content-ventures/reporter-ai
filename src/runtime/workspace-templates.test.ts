import assert from 'node:assert/strict';
import {test} from 'node:test';
import {templateConfigurationHash} from '../domain/workspace-templates.ts';
import type {WorkspaceTemplateConfiguration,WorkspaceTemplateRevision} from '../domain/workspace-templates.ts';
import {LEGACY_TEMPLATE_CATALOG,TEMPLATE_CATALOG} from '../fixtures/templates/catalog.ts';
import {workspaceTemplateEntries,workspaceTemplateLibrary} from './workspace-templates.ts';

const workspaceId='20000000-0000-0000-0000-000000000101';
const config={publication:'Naturaltech',presets:['editorial','photo','night','paper','minimal'] as const,defaultPreset:'editorial' as const,font:'Montserrat' as const,logoId:'20000000-0000-0000-0000-000000000201'};
const revision:WorkspaceTemplateRevision={workspaceId,renderer:'workspace-v1',hash:templateConfigurationHash(workspaceId,{...config,presets:[...config.presets]}),revision:1,savedAt:'2026-10-26T00:00:00Z',savedBy:'operator',config:{...config,presets:[...config.presets]}};
const configuration:WorkspaceTemplateConfiguration={workspaceId,revision:1,pilot:false,readiness:{ready:true,missing:[]},active:revision,history:[]};

test('client composition retains the legacy catalog and brands each approved preset without shared mutation',()=>{
  const before=JSON.stringify([LEGACY_TEMPLATE_CATALOG,TEMPLATE_CATALOG]);
  const entries=workspaceTemplateEntries(revision);assert.equal(entries.length,5);
  for(const entry of entries){
    assert.ok(entry.template.id.startsWith(`wst-${workspaceId}-`));assert.match(entry.template.name,/Naturaltech/);
    assert.equal(entry.meta.status,'base','brand assignment is not a Marketing approval');
    assert.doesNotMatch(JSON.stringify(entry),/Seafood|Pescados Litoral/);
    for(const layout of Object.values(entry.render.layouts)){
      assert.equal(layout.brand?.label,'Naturaltech');assert.equal(layout.brand?.logoId,config.logoId);
      assert.ok(layout.brand!.y+layout.brand!.height<=Math.min(...Object.values(layout.slots).map(slot=>slot.y)),entry.template.id);
      assert.ok(Object.values(layout.slots).every(slot=>slot.fontFamily==='Montserrat'));
    }
  }
  assert.equal(JSON.stringify([LEGACY_TEMPLATE_CATALOG,TEMPLATE_CATALOG]),before);
});
test('active choices are separate from historical rendering and foreign revisions fail closed',()=>{
  const previous={...revision,hash:'1234567890abcdef',revision:0,config:{...revision.config,publication:'Earlier identity'}};
  const library=workspaceTemplateLibrary({...configuration,history:[previous]});
  assert.equal(library.activeIds.length,5);assert.equal(library.templates.length,10);
  assert.ok(library.templates.some(template=>template.name.includes('Earlier identity')));
  assert.equal(workspaceTemplateLibrary({...configuration,active:null,history:[]}).templates.length,0);
  const pilot=workspaceTemplateLibrary({...configuration,pilot:true,active:null,history:[]});
  assert.deepEqual(pilot.activeIds,TEMPLATE_CATALOG.map(entry=>entry.template.id));
  assert.throws(()=>workspaceTemplateLibrary({...configuration,history:[{...previous,workspaceId:'foreign'}]}),/FOREIGN_TEMPLATE_REVISION/);
});
