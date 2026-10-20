import "server-only";
import { createHash,randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { z } from "zod";
import { UUID, articleEditSchema, carouselEditSchema, createSchema, revisionSchema } from "./reporter-schema";
import { assertLocalMode, localContext } from "./config";
import { command, resolveReporterContext, transaction } from "./database";
import { FlowError, logEvent, safeCode } from "./errors";
import { mediaOf } from '../domain/reporter.ts';
import { receiveFile, workerAvailable } from "./storage";
import { IDLE_QUEUE, queueStatus } from "./queue-status.ts";
import { workerUrl } from "./worker-config.ts";
import { kickWorker, shouldHealStall, type Defer } from "./worker-kick.ts";
import { ingestSourceLink } from './source-link';
import { editorialWorkspace, editorialRpc, editorialPipeline, requireCapability } from './editorial';
import { analyzeMaterial } from './material-analysis';
import { handleVisualLibrary } from './visual-library';
import { handleCitationLibrary } from './citation-library';
import { handleProfile } from './profile.ts';
import { handleInvites, handlePlatform } from './platform.ts';
import { driveReceived, driveRetry, handleDrive } from './drive-intake.ts';
import { reporterDeploymentMode } from './deployment.ts';
import { reporterIdentity } from './auth.ts';
import { runWithReporterContext, type ReporterRequestContext } from './request-context.ts';
import { appHealth } from './app-config.ts';

const LOOPBACK = new Set(["localhost","127.0.0.1","[::1]"]);
export function guardLocalRequest(request: Request) {
  assertLocalMode();
  const url = new URL(request.url), host = request.headers.get("host");
  const authority = host ? new URL(url.protocol + "//" + host) : null;
  // Next may normalize the internal URL to localhost even when the browser
  // uses 127.0.0.1. Validate both authorities without requiring equal aliases.
  if (!authority || !LOOPBACK.has(url.hostname) || !LOOPBACK.has(authority.hostname) ||
    authority.port !== url.port || authority.username || authority.password) throw new FlowError("LOCAL_ACCESS_ONLY", 403);
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded && forwarded.split(",").some(ip => !["127.0.0.1","::1","::ffff:127.0.0.1"].includes(ip.trim()))) throw new FlowError("LOCAL_ACCESS_ONLY", 403);
  const origin = request.headers.get("origin");
  if (origin && origin !== authority.origin) throw new FlowError("ORIGIN_DENIED", 403);
  if (!["GET","HEAD"].includes(request.method) && request.headers.get("x-reporter-client") !== "local") throw new FlowError("CLIENT_HEADER_REQUIRED", 403);
}

type Identity = Awaited<ReturnType<typeof reporterIdentity>>;

async function guardReporterRequest(request: Request, identify: () => Promise<Identity> = reporterIdentity): Promise<ReporterRequestContext> {
  if (reporterDeploymentMode() === 'local') {
    guardLocalRequest(request);
    return { ...localContext,roles: [...localContext.roles] };
  }
  const url = new URL(request.url);
  const origin = request.headers.get('origin');
  if (!['GET','HEAD'].includes(request.method) && (!origin || origin !== url.origin)) throw new FlowError('ORIGIN_DENIED',403);
  const identity = await identify();
  if (!identity) throw new FlowError('AUTH_REQUIRED',401);
  const context = await resolveReporterContext(identity);
  if (!context) throw new FlowError(identity.emailVerified ? 'ACCESS_PENDING' : 'EMAIL_NOT_VERIFIED',403);
  return context;
}

async function jsonBody(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new FlowError("JSON_REQUIRED", 415);
  if (!request.body) throw new FlowError("INVALID_JSON", 400);
  const reader = request.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 2 * 1024 ** 2) { await reader.cancel(); throw new FlowError("PAYLOAD_TOO_LARGE", 413); }
      chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new FlowError("INVALID_JSON", 400); }
  } finally { reader.releaseLock(); }
}
function idempotencyKey(request: Request) {
  const key = request.headers.get("idempotency-key");
  if (!key || !/^[a-zA-Z0-9_-]{8,128}$/.test(key)) throw new FlowError("IDEMPOTENCY_KEY_REQUIRED", 400);
  return key;
}
function reply(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
const messages: Record<string, string> = {
  CITATION_NOT_LITERAL: 'Copie um trecho contínuo da transcrição, com pelo menos quatro palavras. Não altere a fala.',
  CITATION_METADATA_INVALID: 'Confira a data e o link HTTPS do episódio.',
  CITATION_AUTHOR_INVALID: 'Escolha um participante do material e confirme a autoria; não atribua uma voz por suposição.',
  CITATION_IMMUTABLE: 'As palavras e a fonte de uma citação salva não podem ser reescritas. Adicione outro trecho literal.',
  CITATION_CONFLICT: 'Esta citação foi alterada em outra aba. Recarregue antes de salvar.',
  FORBIDDEN: 'Você não tem permissão para isso.',
  TRANSCRIPT_NOT_READY: 'A transcrição ainda não está pronta. Aguarde sua conclusão antes de criar a produção.',
  SOURCE_NOT_AUTHORIZED: 'Este material não está autorizado para uso.',
  IMAGE_DRAFT_CONFLICT: 'O rascunho mudou ou ainda há alterações não salvas. Aguarde o salvamento antes de buscar imagens.',
  ARTICLE_LOCKED: 'Aguarde a geração terminar ou retire o artigo da aprovação antes de preencher imagens.',
  PIXABAY_KEY_MISSING: 'Adicione PIXABAY_API_KEY no .env.local e reinicie o servidor. A chave fica somente no backend.',
  PIXABAY_ORIGINAL_REQUIRED: 'O original em alta resolução não está disponível. Solicite acesso completo à API do Pixabay ou escolha uma foto com original de pelo menos 2400 × 1350 px. A prévia reduzida não será importada.',
  UNSPLASH_KEY_MISSING: 'Adicione UNSPLASH_ACCESS_KEY no .env.local e reinicie o servidor. Use a Access Key da aplicação, não a Secret Key.',
  PEXELS_KEY_MISSING: 'Adicione PEXELS_API_KEY no .env.local e reinicie o servidor. O Openverse funciona sem chave.',
  STOCK_UNAVAILABLE: 'O banco de imagens não respondeu. Tente novamente.',
  STOCK_RATE_LIMIT: 'Limite temporário de buscas. Aguarde e tente novamente.',
  STOCK_ACCESS_DENIED: 'O banco recusou o acesso. Confira a chave e as permissões da API.',
  STOCK_INVALID: 'A imagem ou sua licença não atende aos critérios desta biblioteca. Escolha outra.',
  IMAGE_TOO_LARGE: 'A imagem original excede 10 MB. Escolha outra imagem.',
  OPENAI_KEY_MISSING: 'A geração de imagens precisa da chave da OpenAI no servidor.',
  OPENAI_AUTH_INVALID: 'A chave da OpenAI foi recusada. Confira a chave no servidor.',
  IMAGE_GENERATION_REFUSED: 'A IA não gerou esta imagem. Ajuste a descrição e gere de novo.',
  IMAGE_GENERATION_FAILED: 'Não foi possível gerar a imagem. Tente de novo.',
  IMAGE_UNAVAILABLE: 'Arquivo da biblioteca indisponível. Selecione outra imagem.',
  BANNER_IMAGE_REQUIRED: 'Escolha uma foto da biblioteca para a capa fotográfica.',
  BANNER_QUOTE_REQUIRED: 'Selecione uma citação literal e informe a atribuição.',
  BANNER_QUOTE_UNSUPPORTED: 'A citação precisa existir no artigo e ter evidência verificada. Abra o banner pelo artigo.',
  BANNER_TEXT_OVERFLOW: 'O texto não cabe neste formato. Encurte a chamada ou escolha outro formato; nada foi cortado.',
  BANNER_CREDIT_OVERFLOW: 'O crédito não cabe neste formato. Escolha um formato maior ou outra imagem.',
  BANNER_CONFLICT: 'Este banner mudou em outra aba. Abra a versão salva antes de editar.',
  LIBRARY_FULL: 'A biblioteca atingiu o limite local. Nenhum arquivo foi apagado.',
  PROFILE_NAME_REQUIRED: 'Informe seu nome.',
  PROFILE_TOO_LONG: 'Use até 80 caracteres no nome e no cargo.',
  AVATAR_INVALID: 'Não foi possível ler esta imagem. Envie um JPG, PNG, WebP ou GIF.',
  AVATAR_TOO_LARGE: 'A foto passa de 4 MB. Escolha outra imagem.',
  AUTH_REQUIRED: 'Entre novamente para continuar.',
  AUTH_CONFIGURATION: 'O acesso ainda não foi configurado neste ambiente.',
  AUTH_CONTEXT_MISSING: 'Não foi possível identificar o workspace deste usuário.',
  ACCESS_PENDING: 'Sua conta existe, mas ainda precisa ser liberada por um administrador.',
  EMAIL_NOT_VERIFIED: 'Confirme seu e-mail antes de acessar o workspace.',
  CLOUD_UPLOAD_PENDING: 'O upload de arquivos grandes ainda não está liberado neste ambiente. Cole uma transcrição por enquanto.',
  UPLOAD_WORKER_UNAVAILABLE: 'O serviço de upload está inicializando. Aguarde alguns segundos e tente novamente.',
  UPLOAD_CONFIGURATION: 'O armazenamento de arquivos ainda não está configurado.',
  WORKER_CONFIGURATION: 'O processamento ainda não está configurado neste ambiente.',
  LOCAL_MODE_DISABLED: "Este fluxo só está disponível no modo local de desenvolvimento.",
  LOCAL_ACCESS_ONLY: "Acesso permitido apenas neste computador.", ORIGIN_DENIED: "Origem não autorizada.",
  ECONNREFUSED: "Banco indisponível. Inicie o PostgreSQL do Reporter IA.",
  GROQ_KEY_MISSING: "Configure GROQ_API_KEY no .env.local.", DATABASE_CONFIGURATION: "Configure o banco local do Reporter IA.",
  GROQ_RATE_LIMIT: 'A Groq atingiu o limite temporário de uso. Aguarde e tente novamente.',
  MATERIAL_ANALYSIS_INVALID: 'A análise do tema e participantes não retornou um resultado válido. Tente novamente.',
  SOURCE_LINK_INVALID: 'Cole o link de um vídeo do YouTube ou de um episódio do Spotify.',
  YOUTUBE_VIDEO_UNAVAILABLE: 'Este vídeo do YouTube não está público ou não pôde ser lido.',
  YOUTUBE_CAPTIONS_UNAVAILABLE: 'Este vídeo não oferece legendas públicas. Baixe o áudio ou vídeo e envie o arquivo.',
  SPOTIFY_EPISODE_NOT_FOUND: 'Não encontramos este episódio no feed público do podcast. Envie o arquivo de áudio.',
  REMOTE_MEDIA_UNAVAILABLE: 'O áudio público deste episódio não pôde ser importado. Envie o arquivo.',
  PIPELINE_STAGE_MISSING: 'A configuração precisa incluir a etapa Material antes de analisar.',
  FILE_TOO_LARGE: "O limite local é de 2 GB por arquivo.", TEXT_TOO_LARGE: "A transcrição TXT deve ter até 1 MB.",
  UNSUPPORTED_MEDIA: "Envie MP3, MP4, M4A, WAV, OGG, OPUS, FLAC, WEBM ou TXT.",
  INVALID_MEDIA: "Não foi possível ler o áudio deste arquivo.", NO_AUDIO_TRACK: "O arquivo não tem uma faixa de áudio.",
  MEDIA_DURATION: "O arquivo deve ter áudio com duração de até 3 horas.",
  INVALID_TEXT_ENCODING: "Salve a transcrição TXT em UTF-8.", INVALID_TRANSCRIPT: "A transcrição está vazia ou inválida.",
  "40001": "O conteúdo mudou. Atualize a tela e tente novamente.",
  "22023": "Dados inválidos ou pedido repetido com informações diferentes.", "23514": "O conteúdo ainda não está no estado necessário.",
};

const EDITORIAL_ENQUEUE = new Set(['generation.start','generation.retry']);
const runAfterResponse: Defer = task => { void task().catch(() => {}); };

/** `defer` runs work after the response; the route handler passes Next's `after`.
 * `identify` replaces the Neon Auth session lookup only in the local cloud rehearsal. */
export async function handleReporter(request: Request, path: string[], deps: { defer?: Defer; identify?: () => Promise<Identity> } = {}) {
  const requestId = randomUUID();
  const defer = deps.defer ?? runAfterResponse;
  // Every committed enqueue wakes the cloud worker; a stall seen by a poll wakes it again.
  const kick = () => defer(() => kickWorker());
  const heal = (stalled: boolean | undefined) => { if (stalled && shouldHealStall()) kick(); };
  try {
    // The release probe is public: booleans and versions only, no session and no database.
    if (request.method === 'GET' && path.length === 1 && path[0] === 'health') return reply(appHealth());
    // The platform console and the access link have their own guards: no workspace membership.
    if (path[0] === 'platform') return await handlePlatform(request,path.slice(1),{ readJson: jsonBody,guardLocal: guardLocalRequest,identify: deps.identify });
    if (path[0] === 'invites') return await handleInvites(request,path.slice(1),{ readJson: jsonBody,guardLocal: guardLocalRequest });
    // The Drive folder script has no session: it carries the intake secret and acts as one configured member.
    if (path[0] === 'drive' && path[1] === 'sync') return await handleDrive(request,path.slice(1),{ readJson: jsonBody,defer });
    const context = await guardReporterRequest(request, deps.identify);
    return await runWithReporterContext(context, async () => {
    if (path[0] === 'citations') return await handleCitationLibrary(request,path.slice(1),jsonBody);
    if (path[0] === 'visuals') return await handleVisualLibrary(request,path.slice(1),jsonBody);
    if (path[0] === 'profile') return await handleProfile(request,path.slice(1),jsonBody);
    if (request.method === 'GET' && path.length === 1 && path[0] === 'pipeline') return reply(await editorialPipeline());
    if (request.method === 'GET' && path[0] === 'drive' && path[1] === 'received') return await driveReceived(path.slice(2));
    if (path[0] === 'workspace' && path.length === 1) {
      if (request.method === 'GET') {
        const query = new URL(request.url).searchParams;
        const workspace = await editorialWorkspace(query.get('since') ?? undefined,{ active: query.get('active') === '1' });
        heal(workspace.stalled);
        return reply(workspace);
      }
      if (request.method === 'POST') {
        const payload = await jsonBody(request);
        const result = await editorialRpc(payload);
        if (EDITORIAL_ENQUEUE.has((payload as { method?: unknown })?.method as string) && (result as { ok?: unknown })?.ok === true) kick();
        return reply(result);
      }
    }
    if (request.method === "GET" && path.length === 0) {
      const state = await transaction("runtime", async client => (await client.query("SELECT public.reporter_local_state() AS state")).rows[0].state, requestId);
      return reply({ ...state, worker_online: await workerAvailable(), groq_configured: Boolean(process.env.GROQ_API_KEY?.trim()) });
    }
    if (request.method === 'GET' && path.length === 2 && path[0] === 'transcripts') {
      const id = UUID.parse(path[1]);
      const { transcript,queue } = await transaction('runtime',async client => {
        const value = (await client.query('SELECT public.reporter_local_transcript($1) AS value',[id])).rows[0].value;
        return { transcript: value,queue: ['queued','processing'].includes(value?.status) ? await queueStatus(client,`transcript:${id}`) : IDLE_QUEUE };
      },requestId);
      if (!transcript) throw new FlowError('NOT_FOUND',404);
      heal(queue.stalled);
      return reply({ transcript,worker_online: await workerAvailable(),stalled: queue.stalled });
    }
    if (request.method !== "POST") return reply({ error: "NOT_FOUND", message: "Rota não encontrada." }, 404);
    if (path[0] === 'drive' && path[1] === 'received' && path.length === 4 && path[3] === 'retry') {
      await requireCapability('production.create');
      const retried = await driveRetry(path[2],await jsonBody(request),idempotencyKey(request));
      kick();
      return retried;
    }
    // Material intake belongs to whoever creates productions; refused before any fetch, upload or AI call.
    if (path.length === 1 && ['uploads','files','links'].includes(path[0]) || path.join('/') === 'material/analysis') await requireCapability('production.create');
    if (path.length===1 && path[0]==='uploads') {
      if (reporterDeploymentMode()!=='cloud') return reply({ mode: 'local' });
      const key = idempotencyKey(request);
      const input = z.object({ sourceId: UUID,token: z.string().min(32).max(128),name: z.string().trim().min(1).max(255),
        size: z.number().int().min(1).max(2*1024**3) }).strict().parse(await jsonBody(request));
      if (/[\x00-\x1f\x7f-\x9f\\/]/.test(input.name)) throw new FlowError('UNSUPPORTED_MEDIA',415);
      // The stored extension: an Opus file (WhatsApp audio) is stored as the Ogg file it is.
      const media = mediaOf(input.name);
      if (!media) throw new FlowError('UNSUPPORTED_MEDIA',415);
      const { extension, contentType } = media;
      const objectKey = `incoming/${context.portal}/${input.sourceId}.${extension}`;
      const tokenHash = createHash('sha256').update(input.token,'utf8').digest('hex');
      const value = await transaction('runtime',async client => (await client.query(
        'SELECT public.reporter_prepare_cloud_upload($1,$2,$3,$4,$5,$6,$7) AS value',
        [input.sourceId,input.name.normalize('NFC'),input.size,contentType,objectKey,tokenHash,key],
      )).rows[0].value,requestId);
      // The configured worker URL wins; the SQL value only covers an unconfigured environment.
      const endpoint = workerUrl() ?? value.upload_endpoint;
      if (!endpoint) throw new FlowError('UPLOAD_CONFIGURATION',503);
      return reply({ mode: 'cloud',...value,upload_endpoint: endpoint },202);
    }
    if (path.length === 1 && path[0] === "files") {
      if (reporterDeploymentMode() === 'cloud') throw new FlowError('CLOUD_UPLOAD_PENDING',503);
      const key = idempotencyKey(request);
      const file = await receiveFile(request);
      // A connection loss during COMMIT is ambiguous. Retain an unreferenced
      // sealed file for reconciliation rather than deleting possibly committed data.
      let removeDuplicate = false;
      try {
        const value = await transaction("runtime", async client => (await client.query(
          "SELECT public.reporter_intake($1,$2,$3,$4,$5,$6,$7) AS result",
          [file.id,file.name,file.size,file.contentType,file.checksum,file.content,key])).rows[0].result, requestId);
        removeDuplicate = value.source_id !== file.id;
        logEvent("api", "source_accepted", { request_id: requestId });
        return reply(value, 202);
      } finally { if (removeDuplicate) await rm(file.destination, { force: true }).catch(() => {}); }
    }
    if (path.length === 1 && path[0] === 'links') {
      const key = idempotencyKey(request);
      const input = z.object({ url: z.string().trim().url().max(2000) }).strict().parse(await jsonBody(request));
      const imported = await ingestSourceLink(input.url,request.signal);
      if (imported.kind==='ready') return reply(imported);
      if (imported.kind === 'remote') {
        const id=randomUUID(),token=randomUUID()+randomUUID(),objectKey=`incoming/${context.portal}/${id}.${imported.extension}`;
        const contentType=mediaOf('.'+imported.extension)?.contentType;
        const value=await transaction('runtime',async client=>(await client.query('SELECT public.reporter_prepare_remote_link($1,$2,$3,$4,$5,$6,$7,$8) AS value',
          [id,imported.fileName,imported.size,contentType,objectKey,createHash('sha256').update(token).digest('hex'),key,imported.remoteUrl])).rows[0].value,requestId);
        kick();
        return reply({kind:'processing',provider:imported.provider,sourceUrl:imported.sourceUrl,title:imported.title,programName:imported.programName,fileName:imported.fileName,bytes:imported.size,id:value.id},202);
      }
      const file = imported.file;
      let removeDuplicate = false;
      try {
        const value = await transaction('runtime',async client => (await client.query(
          'SELECT public.reporter_intake($1,$2,$3,$4,$5,$6,$7) AS result',
          [file.id,file.name,file.size,file.contentType,file.checksum,file.content,key])).rows[0].result,requestId);
        removeDuplicate = value.source_id!==file.id;
        return reply({ kind: imported.kind,provider: imported.provider,sourceUrl: imported.sourceUrl,title: imported.title,
          programName: imported.programName,fileName: file.name,bytes: file.size,id: value.id },202);
      } finally { if (removeDuplicate) await rm(file.destination,{ force: true }).catch(() => {}); }
    }
    if (path.join('/') === 'material/analysis') {
      const input = z.object({ text: z.string().min(1).max(1048576), fileName: z.string().max(255).optional(),
        format: z.enum(['plain','speaker-lines','srt','vtt','auto']).optional() }).strict().parse(await jsonBody(request));
      return reply(await analyzeMaterial(input.text, { fileName: input.fileName, format: input.format }));
    }
    const kind = path[0] === "articles" ? "article" : path[0] === "carousels" ? "carousel" : path[0] === "transcripts" ? "transcript" : null;
    if (!kind) throw new FlowError("NOT_FOUND", 404);
    const body = await jsonBody(request);
    if (path.length === 1 && kind !== "transcript") {
      const input = createSchema.parse(body);
      const id = await command("reporter_create", [kind,input.source_id,input.input_revision,idempotencyKey(request),{}], requestId);
      kick();
      return reply({ id }, 202);
    }
    const id = UUID.parse(path[1]);
    const action = path[2];
    let revision: number;
    if (path.length !== 3) throw new FlowError("NOT_FOUND", 404);
    if (action === "edit" && kind === "article") {
      const input = articleEditSchema.parse(body);
      revision = await command<number>("reporter_edit_article", [id,input.revision,input.title,input.content], requestId);
    } else if (action === "edit" && kind === "carousel") {
      const input = carouselEditSchema.parse(body);
      revision = await command<number>("reporter_edit_carousel", [id,input.revision,input.title,JSON.stringify(input.slides)], requestId);
    } else if (action === "submit" && kind === "article") {
      revision = await command<number>("reporter_submit_article", [id,revisionSchema.parse(body).revision], requestId);
    } else if (["approve","changes"].includes(action) && kind === "article") {
      const input = revisionSchema.extend({ comment: z.string().trim().max(4000).optional() }).parse(body);
      revision = await command<number>("reporter_review_article", [id,input.revision,action === "approve",input.comment ?? null], requestId);
    } else if (action === "ready" && kind === "carousel") {
      revision = await command<number>("reporter_ready_carousel", [id,revisionSchema.parse(body).revision], requestId);
    } else if (action === "retry") {
      const generation = await command("reporter_retry", [kind,id,revisionSchema.parse(body).revision,idempotencyKey(request)], requestId);
      kick();
      return reply({ id, generation_id: generation }, 202);
    } else throw new FlowError("NOT_FOUND", 404);
    return reply({ id, revision });
    });
  } catch (error) {
    // An SQL permission refusal (42501) and an app role refusal are the same FORBIDDEN for the browser.
    const raw = error instanceof z.ZodError ? "INVALID_INPUT" : safeCode(error);
    const code = raw === "42501" ? "FORBIDDEN" : raw;
    const status = error instanceof FlowError ? error.status : error instanceof z.ZodError ? 422 :
      code === "40001" ? 409 : code === "FORBIDDEN" ? 403 : ["22023","23514"].includes(code) ? 422 :
      code === '55000' ? 503 :
      code === 'AUTH_REQUIRED' ? 401 : ['ACCESS_PENDING','EMAIL_NOT_VERIFIED'].includes(code) ? 403 :
      ["ECONNREFUSED","DATABASE_CONFIGURATION","GROQ_KEY_MISSING","LOCAL_MODE_DISABLED","AUTH_CONFIGURATION","CLOUD_UPLOAD_PENDING","UPLOAD_CONFIGURATION"].includes(code) ? 503 : 500;
    logEvent("api", "request_failed", { request_id: requestId, error_code: code });
    return reply({ error: code, message: (error instanceof FlowError ? error.reason : undefined) ?? messages[code==='55000' ? 'UPLOAD_WORKER_UNAVAILABLE' : code] ?? (status < 500 ? "Revise os dados enviados." : "Não foi possível concluir. Tente novamente."), request_id: requestId }, status);
  }
}
