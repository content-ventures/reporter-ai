import "server-only";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, lstat, realpath, stat, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { join, basename, extname } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import busboy from "busboy";
import { MAX_TEXT_BYTES, MAX_UPLOAD_BYTES } from "../domain/reporter";
import { UUID } from "./reporter-schema";
import { FlowError } from "./errors";
import { inspectMedia } from "./media";
import { reporterDeploymentMode } from './deployment.ts';
import { transaction } from './database.ts';

export async function storageRoot() {
  const root = join(process.cwd(), ".reporter-local");
  await mkdir(root, { recursive: true, mode: 0o700 });
  if (!(await lstat(root)).isDirectory() || (await lstat(root)).isSymbolicLink()) throw new FlowError("UNSAFE_STORAGE", 500);
  if (await realpath(root) !== root) throw new FlowError("UNSAFE_STORAGE", 500);
  return root;
}
export async function sourcePath(key: string) {
  if (!/^[0-9a-f-]{36}\.source$/.test(key) || !UUID.safeParse(key.slice(0, 36)).success) throw new FlowError("UNSAFE_STORAGE", 500);
  const path = join(await storageRoot(), key);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new FlowError("SOURCE_UNAVAILABLE", 422);
  return path;
}
export async function verifySource(key: string, expectedSize: number, checksum: string) {
  const path = await sourcePath(key);
  if ((await stat(path)).size !== Number(expectedSize)) throw new FlowError("SOURCE_CHANGED", 422);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  if (hash.digest("hex") !== checksum) throw new FlowError("SOURCE_CHANGED", 422);
  return path;
}
export async function workDirectory(generation: string) {
  UUID.parse(generation);
  const path = join(await storageRoot(), generation + ".work");
  await mkdir(path, { recursive: true, mode: 0o700 });
  if ((await lstat(path)).isSymbolicLink()) throw new FlowError("UNSAFE_STORAGE", 500);
  return path;
}
/** Private, exact-request facts checkpoints shared by outline and article jobs. */
export async function sourcePreparationDirectory() {
  const path = join(await storageRoot(), 'editorial-facts.work');
  await mkdir(path, { recursive: true, mode: 0o700 });
  if (!(await lstat(path)).isDirectory() || (await lstat(path)).isSymbolicLink()) throw new FlowError('UNSAFE_STORAGE', 500);
  return path;
}
export async function cacheRead<T>(directory: string, name: string): Promise<T | null> {
  try {
    const path = join(directory, name + ".json");
    if ((await lstat(path)).isSymbolicLink()) throw new FlowError("UNSAFE_STORAGE", 500);
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
export async function cacheWrite(directory: string, name: string, value: unknown) {
  const temporary = join(directory, randomUUID() + ".tmp");
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: "wx" });
  await rename(temporary, join(directory, name + ".json"));
}
export async function workerHeartbeat() {
  if (reporterDeploymentMode() === 'cloud') {
    try {
      return await transaction('runtime',async client => Boolean((await client.query('SELECT public.reporter_worker_online() AS online')).rows[0]?.online));
    } catch { return false; }
  }
  try {
    const heartbeat = JSON.parse(await readFile(join(await storageRoot(), "worker.json"), "utf8"));
    return Number.isFinite(heartbeat.timestamp) && Date.now() - heartbeat.timestamp < 15000;
  } catch { return false; }
}
export async function receiveFile(request: Request) {
  const type = request.headers.get("content-type") ?? "";
  if (!type.startsWith("multipart/form-data;")) throw new FlowError("MULTIPART_REQUIRED", 415);
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_UPLOAD_BYTES + 65536) throw new FlowError("FILE_TOO_LARGE", 413);
  if (!request.body) throw new FlowError("FILE_REQUIRED", 400);
  const root = await storageRoot(), id = randomUUID(), temporary = join(root, id + ".pending");
  let name = "", size = 0, received = false, failure: FlowError | null = null;
  const hash = createHash("sha256");
  let parser: ReturnType<typeof busboy>;
  // Browser multipart filenames are UTF-8. Latin-1 decoding corrupts accents,
  // and decomposed macOS accents can become control characters rejected by SQL.
  try { parser = busboy({ headers: { "content-type": type }, defParamCharset: "utf8", limits: { files: 1, fields: 0, parts: 2, fileSize: MAX_UPLOAD_BYTES } }); }
  catch { throw new FlowError("INVALID_MULTIPART", 400); }
  let writing: Promise<void> = Promise.resolve();
  parser.on("file", (field, file, info) => {
    received = true;
    name = basename((info.filename ?? "").replace(/\\/g, "/")).normalize("NFC");
    const extension = extname(name).toLowerCase();
    if (field !== "file" || !name || name.length > 255 || /[\x00-\x1f\x7f-\x9f]/.test(name) ||
      ![".mp3",".mp4",".m4a",".wav",".ogg",".flac",".webm",".txt",".md",".srt",".vtt"].includes(extension)) {
      failure = new FlowError("UNSUPPORTED_MEDIA", 415); file.resume(); return;
    }
    file.on("limit", () => { failure = new FlowError("FILE_TOO_LARGE", 413); });
    const counter = new Transform({ transform(chunk, _encoding, callback) {
      size += chunk.length;
      if ([".txt",".md",".srt",".vtt"].includes(extension) && size > MAX_TEXT_BYTES) { callback(new FlowError("TEXT_TOO_LARGE", 413)); return; }
      hash.update(chunk); callback(null, chunk);
    } });
    writing = pipeline(file, counter, createWriteStream(temporary, { flags: "wx", mode: 0o600 }));
    void writing.catch(error => parser.destroy(error));
  });
  for (const event of ["filesLimit","fieldsLimit","partsLimit"]) parser.on(event, () => { failure = new FlowError("ONE_FILE_REQUIRED", 400); });
  const timeout = AbortSignal.timeout(10 * 60 * 1000);
  try {
    let wireBytes = 0;
    const wireLimit = new Transform({ transform(chunk, _encoding, callback) {
      wireBytes += chunk.length;
      callback(wireBytes > MAX_UPLOAD_BYTES + 65536 ? new FlowError("FILE_TOO_LARGE", 413) : null, chunk);
    } });
    await pipeline(Readable.fromWeb(request.body as never), wireLimit, parser, { signal: AbortSignal.any([request.signal, timeout]) });
    await writing;
    if (failure) throw failure;
    if (!received || !size) throw new FlowError("FILE_REQUIRED", 400);
    let content: string | null = null, contentType: string;
    if ([".txt",".md",".srt",".vtt"].includes(extname(name).toLowerCase())) {
      try { content = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(temporary)); }
      catch { throw new FlowError("INVALID_TEXT_ENCODING", 422); }
      if (!content.trim() || content.includes("\0")) throw new FlowError("INVALID_TRANSCRIPT", 422);
      contentType = "text/plain";
    } else {
      contentType = (await inspectMedia(temporary, request.signal)).contentType;
    }
    const destination = join(root, id + ".source");
    await rename(temporary, destination);
    return { id, name, size, contentType, checksum: hash.digest("hex"), content, destination };
  } catch (error) {
    parser.destroy();
    await writing.catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
    if (error instanceof FlowError) throw error;
    throw new FlowError("UPLOAD_FAILED", 400);
  }
}

function privateAddress(value: string): boolean {
  const address = value.toLowerCase().split('%')[0];
  if (isIP(address) === 4) {
    const [a,b] = address.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19));
  }
  if (isIP(address) === 6) {
    if (address === '::' || address === '::1' || address.startsWith('fc') || address.startsWith('fd')) return true;
    if (/^fe[89ab]/.test(address)) return true;
    if (address.startsWith('::ffff:') && !/^::ffff:\d+\.\d+\.\d+\.\d+$/.test(address)) return true;
    const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    return mapped ? privateAddress(mapped) : false;
  }
  return true;
}

async function safeRemoteUrl(value: string): Promise<URL> {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new FlowError('REMOTE_MEDIA_UNAVAILABLE',422); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw new FlowError('REMOTE_MEDIA_UNAVAILABLE',422);
  const addresses = await lookup(url.hostname,{ all: true,verbatim: true }).catch(() => []);
  if (!addresses.length || addresses.some(entry => privateAddress(entry.address))) throw new FlowError('REMOTE_MEDIA_UNAVAILABLE',422);
  return url;
}

async function remoteResponse(source: string, signal: AbortSignal): Promise<Response> {
  let url = await safeRemoteUrl(source);
  for (let redirect=0; redirect<=5; redirect++) {
    const response = await fetch(url,{ redirect: 'manual',signal,headers: { 'user-agent': 'ReporterAI/1.0 (+local podcast import)' } });
    if (![301,302,303,307,308].includes(response.status)) {
      if (!response.ok || !response.body) throw new FlowError('REMOTE_MEDIA_UNAVAILABLE',422);
      return response;
    }
    const location = response.headers.get('location');
    await response.body?.cancel().catch(() => {});
    if (!location || redirect === 5) throw new FlowError('REMOTE_MEDIA_UNAVAILABLE',422);
    url = await safeRemoteUrl(new URL(location,url).toString());
  }
  throw new FlowError('REMOTE_MEDIA_UNAVAILABLE',422);
}

/** Downloads a public podcast enclosure into the same sealed local storage used by uploads. */
export async function receiveRemoteFile(source: string, name: string, requestSignal?: AbortSignal) {
  const extension = extname(name).toLowerCase();
  if (!['.mp3','.mp4','.m4a','.wav','.ogg','.flac','.webm'].includes(extension) || !name || name.length>255 || /[\x00-\x1f\x7f-\x9f]/.test(name)) {
    throw new FlowError('UNSUPPORTED_MEDIA',415);
  }
  const root = await storageRoot(),id = randomUUID(),temporary = join(root,id+'.pending');
  const timeout = AbortSignal.timeout(10*60*1000);
  const signal = requestSignal ? AbortSignal.any([requestSignal,timeout]) : timeout;
  let size = 0;
  const hash = createHash('sha256');
  try {
    const response = await remoteResponse(source,signal);
    const length = Number(response.headers.get('content-length') ?? 0);
    if (length>MAX_UPLOAD_BYTES) throw new FlowError('FILE_TOO_LARGE',413);
    const counter = new Transform({ transform(chunk,_encoding,callback) {
      size += chunk.length;
      if (size>MAX_UPLOAD_BYTES) { callback(new FlowError('FILE_TOO_LARGE',413));return; }
      hash.update(chunk);callback(null,chunk);
    } });
    await pipeline(Readable.fromWeb(response.body as never),counter,createWriteStream(temporary,{ flags: 'wx',mode: 0o600 }),{ signal });
    if (!size) throw new FlowError('REMOTE_MEDIA_UNAVAILABLE',422);
    const contentType = (await inspectMedia(temporary,signal)).contentType;
    const destination = join(root,id+'.source');
    await rename(temporary,destination);
    return { id,name,size,contentType,checksum: hash.digest('hex'),content: null,destination };
  } catch (error) {
    await rm(temporary,{ force: true }).catch(() => {});
    if (error instanceof FlowError) throw error;
    throw new FlowError('REMOTE_MEDIA_UNAVAILABLE',422);
  }
}
