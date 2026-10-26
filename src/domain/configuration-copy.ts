import {defaultEditorialPolicy,editorialPolicyContent} from './editorial-policy.ts';
import {isPreservedPilot} from './workspace-pilot.ts';
import type {PipelineDefinition,PipelineRevision} from './pipeline.ts';
import type {ManagedWorkspace} from './workspace-management.ts';
import type {WorkspaceTemplateConfiguration,WorkspaceTemplateInput} from './workspace-templates.ts';
import {contentHash} from './text/hash.ts';

export const CONFIGURATION_COPY_FIELDS=['editorial_map','writing_guide','prompts','templates'] as const;
export type ConfigurationCopyField=typeof CONFIGURATION_COPY_FIELDS[number];
export type ConfigurationSnapshot={workspace:ManagedWorkspace;pipeline:PipelineRevision|null;templates:WorkspaceTemplateConfiguration};
export type ConfigurationCopyChange={field:ConfigurationCopyField;before:unknown;after:unknown};
export type ConfigurationCopyPreview={source:Pick<ManagedWorkspace,'id'|'name'>;target:Pick<ManagedWorkspace,'id'|'name'>;changes:ConfigurationCopyChange[];token:string;expiresAt:string};
export function configurationStamp(snapshot:ConfigurationSnapshot):string{
  return contentHash({workspace:snapshot.workspace.id,revision:snapshot.workspace.revision,pipeline:snapshot.pipeline?{hash:snapshot.pipeline.hash,revision:snapshot.pipeline.revision,savedAt:snapshot.pipeline.savedAt}:undefined,templates:snapshot.templates.active?.hash});
}
/** Copy only selected settings. The target owns its identity, people, content and assets. */
export function proposeConfigurationCopy(source:ConfigurationSnapshot,target:ConfigurationSnapshot,fields:ConfigurationCopyField[],defaults:PipelineDefinition){
  const before=structuredClone(target.pipeline?.definition??defaults),original=structuredClone(source.pipeline?.definition??defaults);
  let definition=structuredClone(before);
  if(fields.includes('prompts'))definition={...original,editorial:before.editorial};
  if(!isPreservedPilot(target.workspace.id))definition.funnelPreset='neutral-v1';
  const policy=structuredClone(before.editorial??defaultEditorialPolicy()),from=original.editorial??defaultEditorialPolicy();
  if(fields.includes('editorial_map'))policy.map={...structuredClone(from.map),version:policy.map.version,updatedAt:policy.map.updatedAt,updatedBy:policy.map.updatedBy};
  if(fields.includes('writing_guide'))policy.guide={...structuredClone(from.guide),version:policy.guide.version,updatedAt:policy.guide.updatedAt,updatedBy:policy.guide.updatedBy};
  if(fields.includes('editorial_map')||fields.includes('writing_guide')||before.editorial)definition.editorial=policy;
  const old=target.templates.active?.config;
  let templates:WorkspaceTemplateInput|undefined;
  if(fields.includes('templates')){
    const configured=source.templates.active?.config;if(!configured)throw new Error('COPY_TEMPLATES_UNAVAILABLE');
    templates={publication:old?.publication??target.workspace.name,presets:[...configured.presets],defaultPreset:configured.defaultPreset,font:configured.font,...(old?.logoId?{logoId:old.logoId}:{})};
  }
  const content=(value:PipelineDefinition,field:ConfigurationCopyField)=>{
    if(field==='editorial_map')return editorialPolicyContent(value.editorial??defaultEditorialPolicy()).map;
    if(field==='writing_guide')return editorialPolicyContent(value.editorial??defaultEditorialPolicy()).guide;
    const {editorial:_,...prompts}=value;void _;return prompts;
  };
  return{definition,templates,changes:fields.map(field=>({field,before:field==='templates'?old??null:content(before,field),after:field==='templates'?templates:content(definition,field)}))};
}
