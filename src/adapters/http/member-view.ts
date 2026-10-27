import type {MemberView} from '../../domain/member-view.ts';
import type {MemberViewing} from '../../ports/member-view.ts';
import {ok,refuse} from '../../domain/result.ts';
import {isForbidden,ReporterHttpError,type ReporterTransport} from './reporter-client.ts';

export function createHttpMemberViewing(http:ReporterTransport,ready:()=>Promise<unknown>,account:()=>string|undefined):MemberViewing{
  return{
    async start(workspaceId,personId){
      try{await ready();return ok(await http.request<MemberView>('/platform/member-views',{workspaceId,personId}));}
      catch(error){return refuse(isForbidden(error)||error instanceof ReporterHttpError&&error.status===403?'restricted':'unavailable',error instanceof Error?error.message:'Não foi possível abrir a visualização.');}
    },
    async end(id,reason='exit'){
      try{
        await ready();const actor=account();if(!actor)throw new Error('A conta desta visualização não está disponível.');
        // This owned audit cleanup must survive disposal of the editorial runtime it closes.
        const response=await fetch(`/api/reporter/member-views/${encodeURIComponent(id)}/end`,{method:'POST',cache:'no-store',credentials:'same-origin',keepalive:true,
          headers:{'x-reporter-client':'local','x-reporter-account':actor,'content-type':'application/json'},body:JSON.stringify({reason}),signal:AbortSignal.timeout(10000)});
        const value=await response.json() as {ok?:boolean;error?:string;message?:string};
        if(!response.ok)throw new ReporterHttpError(value.message??'Não foi possível encerrar a visualização.',value.error??'UNAVAILABLE',response.status);
        if(value.ok!==true)throw new Error('O encerramento da visualização não foi confirmado.');
        return ok(true as const);
      }
      catch(error){return refuse(isForbidden(error)||error instanceof ReporterHttpError&&error.status===403?'restricted':'unavailable',error instanceof Error?error.message:'Não foi possível encerrar a visualização.');}
    },
  };
}
