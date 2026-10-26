import type {IsoDateTime,TemplateId,WorkspaceId} from './ids.ts';
import {contentHash} from './text/hash.ts';
import {ok,refuse,type Result} from './result.ts';
import type {WorkspaceReadiness} from './workspace-management.ts';

/** Approved, brandable compositions. Historical Seafood render definitions stay separate. */
export const WORKSPACE_TEMPLATE_PRESETS=['editorial','photo','night','paper','minimal'] as const;
export type WorkspaceTemplatePreset=typeof WORKSPACE_TEMPLATE_PRESETS[number];
export const WORKSPACE_TEMPLATE_FONTS=['Inter','Montserrat'] as const;
export type WorkspaceTemplateFont=typeof WORKSPACE_TEMPLATE_FONTS[number];
export type WorkspaceTemplateInput={publication:string;presets:WorkspaceTemplatePreset[];defaultPreset:WorkspaceTemplatePreset;font:WorkspaceTemplateFont;logoId?:string};
export type WorkspaceTemplateRevision={workspaceId:WorkspaceId;renderer:'workspace-v1';hash:string;revision:number;savedAt:IsoDateTime;savedBy:string;config:WorkspaceTemplateInput};
export type WorkspaceTemplateConfiguration={workspaceId:WorkspaceId;revision:number;pilot:boolean;readiness:WorkspaceReadiness;active:WorkspaceTemplateRevision|null;history:WorkspaceTemplateRevision[]};
export type WorkspaceBrandAsset={id:string;workspaceId:WorkspaceId;mime:'image/png';width:number;height:number;createdAt:IsoDateTime};
export type TemplateConfigurationRefusal='invalid_configuration'|'unknown_logo'|'conflict'|'restricted'|'unavailable';

export function validateTemplateConfiguration(input:WorkspaceTemplateInput):Result<WorkspaceTemplateInput,'invalid_configuration'>{
  const publication=input.publication.trim();
  if(publication.length<2||publication.length>80||/\p{C}/u.test(publication)||!WORKSPACE_TEMPLATE_FONTS.includes(input.font)
    ||input.presets.length<1||input.presets.length>WORKSPACE_TEMPLATE_PRESETS.length||new Set(input.presets).size!==input.presets.length
    ||input.presets.some(preset=>!WORKSPACE_TEMPLATE_PRESETS.includes(preset))||!input.presets.includes(input.defaultPreset)
    ||input.logoId!==undefined&&!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(input.logoId))
    return refuse('invalid_configuration','Informe o veículo, os modelos disponíveis e o modelo padrão.');
  return ok({...structuredClone(input),publication,presets:[input.defaultPreset,...input.presets.filter(preset=>preset!==input.defaultPreset)]});
}
export function templateConfigurationHash(workspaceId:WorkspaceId,config:WorkspaceTemplateInput):string{return contentHash({workspaceId,renderer:'workspace-v1',config});}
/** Versioned IDs make an approved old export independent of subsequent brand changes. */
export function workspaceTemplateId(revision:Pick<WorkspaceTemplateRevision,'workspaceId'|'hash'>,preset:WorkspaceTemplatePreset):TemplateId{
  return `wst-${revision.workspaceId}-${revision.hash}-${preset}`;
}
export function workspaceTemplateHash(id:string,workspaceId:WorkspaceId):string|undefined{
  const prefix=`wst-${workspaceId}-`;if(!id.startsWith(prefix))return undefined;
  return /^([a-f0-9]{16})-(?:editorial|photo|night|paper|minimal)$/.exec(id.slice(prefix.length))?.[1];
}
export function assignedTemplateIds(revision:WorkspaceTemplateRevision|null|undefined):TemplateId[]{return revision?.config.presets.map(preset=>workspaceTemplateId(revision,preset))??[];}
