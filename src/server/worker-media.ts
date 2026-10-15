import 'server-only';
import { access,readFile,stat } from 'node:fs/promises';
import { dirname,join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type MediaTool = 'ffmpeg'|'ffprobe';
const loader='/lib/ld-linux-aarch64.so.1';
const packageRoot=dirname(fileURLToPath(import.meta.url));
const bundledPath=(tool:MediaTool)=>join(packageRoot,'bin',tool);

export function mediaExecutable(tool:MediaTool):Promise<string>{
  const configured=process.env[tool==='ffmpeg'?'REPORTER_FFMPEG':'REPORTER_FFPROBE'];
  return Promise.resolve(configured??(process.env.REPORTER_FUNCTION_RUNTIME==='true'?bundledPath(tool):tool));
}

/** Neon mounts the immutable function package executable but delivers files as 0644.
 * The system ELF loader reads our signed-source build directly from that package.
 * Never stage executables on a writable noexec mount or change mount permissions. */
export function mediaCommand(executable:string,args:string[],runtime=process.env.REPORTER_FUNCTION_RUNTIME==='true'){
  if(runtime&&(['ffmpeg','ffprobe'] as const).some(tool=>executable===bundledPath(tool))){
    return {executable:loader,args:['--library-path',join(dirname(executable),'lib'),executable,...args]};
  }
  return {executable,args};
}

export async function withMediaExecutable<T>(tool:MediaTool,operation:(path:string)=>Promise<T>):Promise<T>{
  return operation(await mediaExecutable(tool));
}

/** Authenticated readiness reports only fixed package metadata, never credentials. */
export async function workerMediaDiagnostics(){
  const tools=await Promise.all((['ffmpeg','ffprobe'] as const).map(async tool=>{
    try{const info=await stat(bundledPath(tool));return {tool,mode:info.mode&0o777,bytes:info.size};}
    catch{return {tool,missing:true};}
  }));
  return {platform:process.platform,arch:process.arch,loaderAvailable:await access(loader).then(()=>true,()=>false),
    version:(await readFile(join(packageRoot,'FFmpeg-VERSION.txt'),'utf8').catch(()=>'missing')).trim(),tools};
}
