import type {CarouselTemplate} from '../../domain/carousel.ts';
import {assignedTemplateIds,workspaceTemplateId} from '../../domain/workspace-templates.ts';
import type {WorkspaceTemplateConfiguration,WorkspaceTemplatePreset,WorkspaceTemplateRevision} from '../../domain/workspace-templates.ts';
import type {TemplateLibraryData,TemplateRender} from '../../ports/render-template.ts';
import {LEGACY_TEMPLATE_CATALOG,TEMPLATE_CATALOG} from './catalog.ts';
import type {TemplateEntry} from './catalog.ts';

const bases:Record<WorkspaceTemplatePreset,string>={editorial:'tpl-provisorio-claro',photo:'tpl-fotografia',night:'tpl-provisorio-escuro',paper:'tpl-pauta',minimal:'tpl-minimal'};
export type WorkspaceTemplateLibrary={templates:CarouselTemplate[];renders:Record<string,TemplateRender>;library:Record<string,TemplateLibraryData>;activeIds:string[]};

/** The five approved compositions are immutable renderer-v1 data; no other client's template enters this pack. */
export function workspaceTemplateEntries(revision:WorkspaceTemplateRevision):TemplateEntry[]{
  if(revision.renderer!=='workspace-v1')throw new Error('UNKNOWN_TEMPLATE_RENDERER');
  return revision.config.presets.map(preset=>{
    const original=[...LEGACY_TEMPLATE_CATALOG,...TEMPLATE_CATALOG].find(entry=>entry.template.id===bases[preset]);
    if(!original)throw new Error('UNKNOWN_TEMPLATE_PRESET');
    const entry=structuredClone(original),id=workspaceTemplateId(revision,preset);
    entry.template.id=id;entry.template.name=`${revision.config.publication} · ${original.template.name}`;entry.render.templateId=id;
    entry.meta={...entry.meta,status:'aprovado',tags:[revision.config.publication,preset],description:original.meta.description};
    delete entry.previewPhoto;
    for(const layout of Object.values(entry.render.layouts)){
      const firstSlot=Math.min(...Object.values(layout.slots).map(slot=>slot.y));
      const height=Math.max(48,Math.min(144,firstSlot-32));
      layout.brand={label:revision.config.publication,...(revision.config.logoId?{logoId:revision.config.logoId}:{}),
        x:96,y:24,width:entry.template.width-192,height,color:layout.accent,background:layout.background,
        fontFamily:revision.config.font,fontWeight:600,fontSize:24};
      layout.marks=layout.marks?.filter(mark=>mark.text!=='“');
      for(const slot of Object.values(layout.slots)){
        slot.fontFamily=revision.config.font;
        if(slot.list)slot.list.fontFamily=revision.config.font;
      }
      for(const mark of layout.marks??[])mark.fontFamily=revision.config.font;
      if(layout.number)layout.number.fontFamily=revision.config.font;
      if(layout.image?.credit)layout.image.credit.fontFamily=revision.config.font;
      if(layout.counter)layout.counter.fontFamily=revision.config.font;
    }
    entry.sample={...entry.sample,cover:{...entry.sample.cover,kicker:revision.config.publication}};
    return entry;
  });
}

export function workspaceTemplateLibrary(configuration:WorkspaceTemplateConfiguration):WorkspaceTemplateLibrary{
  const revisions=[...(configuration.active?[configuration.active]:[]),...configuration.history.filter(entry=>entry.hash!==configuration.active?.hash)];
  if(revisions.some(revision=>revision.workspaceId!==configuration.workspaceId))throw new Error('FOREIGN_TEMPLATE_REVISION');
  const entries=revisions.flatMap(workspaceTemplateEntries);
  // The adopted catalog is available for historical pilot bodies even after an explicit rebrand.
  if(configuration.pilot)entries.push(...structuredClone([...TEMPLATE_CATALOG,...LEGACY_TEMPLATE_CATALOG.filter(legacy=>!TEMPLATE_CATALOG.some(entry=>entry.template.id===legacy.template.id))]));
  return {templates:entries.map(entry=>entry.template),renders:Object.fromEntries(entries.map(entry=>[entry.template.id,entry.render])),
    library:Object.fromEntries(entries.map(entry=>[entry.template.id,{meta:entry.meta,sample:entry.sample,...(entry.previewPhoto?{previewPhoto:entry.previewPhoto}:{})}])),
    activeIds:configuration.active?assignedTemplateIds(configuration.active):configuration.pilot?TEMPLATE_CATALOG.map(entry=>entry.template.id):[]};
}
