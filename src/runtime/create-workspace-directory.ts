import {createReporterTransport} from '../adapters/http/reporter-client.ts';
import {createHttpWorkspaceDirectory} from '../adapters/http/workspace-directory.ts';

/** The entry directory does not bootstrap the pilot or load an editorial checkpoint. */
export function createWorkspaceDirectoryRuntime(){
  const http=createReporterTransport(undefined,{requireAccount:true});
  return{directory:createHttpWorkspaceDirectory(http),dispose:()=>http.dispose()};
}
