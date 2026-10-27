import type {MemberView} from '../../domain/member-view.ts';
import type {MemberViewing} from '../../ports/member-view.ts';
import {ok,refuse} from '../../domain/result.ts';
import {isForbidden,type ReporterTransport} from './reporter-client.ts';

export function createHttpMemberViewing(http:ReporterTransport,ready:()=>Promise<unknown>):MemberViewing{
  return{
    async start(workspaceId,personId){
      try{await ready();return ok(await http.request<MemberView>('/platform/member-views',{workspaceId,personId}));}
      catch(error){return refuse(isForbidden(error)?'restricted':'unavailable',error instanceof Error?error.message:'Não foi possível abrir a visualização.');}
    },
    async end(id,reason='exit'){
      try{await ready();await http.request(`/member-views/${encodeURIComponent(id)}/end`,{reason});return ok(true as const);}
      catch(error){return refuse(isForbidden(error)?'restricted':'unavailable',error instanceof Error?error.message:'Não foi possível encerrar a visualização.');}
    },
  };
}
