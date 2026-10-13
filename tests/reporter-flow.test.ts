import assert from "node:assert/strict";
import { articleSchema, carouselSchema } from "../src/server/reporter-schema";
import { test, mock } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  audioChunks, mergeSegments, splitSource,  MAX_DURATION_SECONDS,
} from "../src/domain/reporter";
import { guardLocalRequest, handleReporter } from "../src/server/http";
import { FlowError, safeCode, logEvent } from "../src/server/errors";
import { sourcePath, receiveFile } from "../src/server/storage";
import { generateEditorial, generateStructured } from "../src/server/groq";
import { validateEditorialCommandInput } from "../src/server/editorial";

process.env.REPORTER_LOCAL_MODE = "true";
process.env.GROQ_API_KEY = "test-placeholder-not-a-real-key";
// Provider unit tests must not inherit a developer's real keys or model selection.
delete process.env.REPORTER_GENERATION_MODEL;
process.env.GROQ_GENERATION_MODEL = 'openai/gpt-oss-120b';

test("connected commands preserve the approved delivery object and archive array contracts", () => {
  const delivery = { productionId: "production-1",selection: [{ kind: "version",pieceId: "article-1",versionId: "version-2",number: 2,hash: "approved-hash" }],
    mode: "download",files: [{ fileName: "artigo-v2.md",format: "md",versionId: "version-2",ok: true }] };
  assert.doesNotThrow(() => validateEditorialCommandInput("recordDelivery",[delivery]));
  assert.doesNotThrow(() => validateEditorialCommandInput("archive",[["production-1"]]));
  assert.doesNotThrow(() => validateEditorialCommandInput("rename",["production-1","Title"]));
  assert.throws(() => validateEditorialCommandInput("recordDelivery",["production-1"]));
  assert.throws(() => validateEditorialCommandInput("recordDelivery",[{ ...delivery,mode: "published" }]));
  assert.throws(() => validateEditorialCommandInput("recordDelivery",[{ ...delivery,files: [{ ...delivery.files[0],ok: "true" }] }]));
  assert.throws(() => validateEditorialCommandInput("archive",["production-1"]));
  assert.throws(() => validateEditorialCommandInput("rename",[delivery]));
});

test("hour-long podcasts are covered without gaps and all FLAC parts stay below 25 MB", () => {
  const chunks = audioChunks(3900);
  assert.equal(chunks.length, 7);
  assert.equal(chunks[0].start, 0);
  for (let i = 0; i < chunks.length; i++) {
    assert.ok(chunks[i].duration * 16000 * 2 < 24_000_000);
    if (i) assert.ok(chunks[i].start < chunks[i - 1].start + chunks[i - 1].duration);
  }
  assert.equal(chunks.at(-1)!.start + chunks.at(-1)!.duration, 3900);
});
test("media duration ceilings are explicit", () => {
  for (const duration of [0, -1, NaN, Infinity, MAX_DURATION_SECONDS + 1]) assert.throws(() => audioChunks(duration));
  assert.equal(audioChunks(MAX_DURATION_SECONDS).length, 18);
});
test("overlapping transcript segments retain original offsets and remove repeated boundary words", () => {
  const merged = mergeSegments([{ start_ms: 590000, end_ms: 600000, text: "O investimento foi de 42 milhões." }],
    [{ start_ms: 0, end_ms: 1000, text: "Trecho repetido." },
      { start_ms: 1000, end_ms: 5000, text: "42 milhões. A obra será fiscalizada." }], 598);
  assert.deepEqual(merged, [
    { start_ms: 590000, end_ms: 600000, text: "O investimento foi de 42 milhões." },
    { start_ms: 600000, end_ms: 603000, text: "A obra será fiscalizada." },
  ]);
});
test("long sources include the end of the episode rather than silently truncating it", () => {
  const text = ("Fonte de teste. ".repeat(5000)) + "FINAL DO EPISÓDIO";
  const chunks = splitSource(text);
  assert.ok(chunks.every(chunk => chunk.length <= 12000));
  assert.ok(chunks.at(-1)!.endsWith("FINAL DO EPISÓDIO"));
});
test("article and slides reject empty, extra and invalid fields", () => {
  assert.equal(articleSchema.safeParse({ title: "", content: "text" }).success, false);
  assert.equal(carouselSchema.safeParse({ title: "Title", slides: [null] }).success, false);
  assert.equal(carouselSchema.safeParse({ title: "Title", slides: [{ body: "Text", unsafe_url: "https://example.com" }] }).success, false);
  assert.equal(carouselSchema.safeParse({ title: "Title", slides: Array.from({ length: 21 }, () => ({ body: "Text" })) }).success, false);
});
function localRequest(url = "http://127.0.0.1:3002/api/reporter", extra: RequestInit = {}) {
  return new Request(url, { ...extra, headers: { Host: new URL(url).host, ...extra.headers } });
}
test("local guard accepts loopback but rejects foreign hosts, cross-origin requests and missing client headers", () => {
  guardLocalRequest(localRequest());
  assert.throws(() => guardLocalRequest(localRequest("http://example.com/api/reporter")));
  assert.throws(() => guardLocalRequest(localRequest(undefined, { headers: { Origin: "https://evil.example" } })));
  assert.throws(() => guardLocalRequest(localRequest(undefined, { method: "POST" })));
  guardLocalRequest(localRequest(undefined, { method: "POST", headers: { "X-Reporter-Client": "local" } }));
  assert.throws(() => guardLocalRequest(localRequest(undefined, { headers: { "X-Forwarded-For": "10.0.0.1" } })));
});
test("local mode fails closed in production", () => {
  const environment = process.env as Record<string, string | undefined>;
  const previous = environment.NODE_ENV;
  environment.NODE_ENV = "production";
  try { assert.throws(() => guardLocalRequest(localRequest()), /LOCAL_MODE_DISABLED/); }
  finally { if (previous === undefined) delete environment.NODE_ENV; else environment.NODE_ENV = previous; }
});
test("HTTP rejects cross-origin requests before reaching the database", async () => {
  const response = await handleReporter(localRequest(undefined, { headers: { Origin: "https://evil.example" } }), []);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "ORIGIN_DENIED");
});
test("file storage rejects traversal before any file is opened", async () => {
  await assert.rejects(sourcePath("../../.env.local"), /UNSAFE_STORAGE/);
});
test("errors do not reflect provider bodies or exception messages", () => {
  assert.equal(safeCode(new Error("gsk_private-key raw editorial content")), "INTERNAL_ERROR");
  assert.equal(safeCode(new FlowError("GROQ_RATE_LIMIT", 502, true)), "GROQ_RATE_LIMIT");
});
test("structured logs accept only bounded operational fields and ignore logging failures", () => {
  const lines: string[] = [];
  const spy = mock.method(process.stdout, "write", (chunk: unknown) => { lines.push(String(chunk)); return true; });
  try {
    logEvent("api", "fixture_event", { request_id: "00000000-0000-0000-0000-000000000031", error_code: "INPUT_UNAVAILABLE",
      ...{ raw_prompt: "private", api_key: "gsk_secret", generation_id: "gsk_secret" } });
  } finally { spy.mock.restore(); }
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.schema_version, 1); assert.equal(entry.error_code, "INPUT_UNAVAILABLE");
  assert.equal(entry.raw_prompt, undefined); assert.equal(entry.api_key, undefined); assert.equal(entry.generation_id, undefined);
  const broken = mock.method(process.stdout, "write", () => { throw new Error("fixture logging failure"); });
  try { assert.doesNotThrow(() => logEvent("api", "fixture_failure")); }
  finally { broken.mock.restore(); }
});
function uploadRequest(bytes: Uint8Array | string, name: string, extraField = false) {
  const form = new FormData();
  form.set("file", new Blob([typeof bytes === "string" ? bytes : Uint8Array.from(bytes)], { type: "text/plain" }), name);
  if (extraField) form.set("actor_id", "untrusted");
  return new Request("http://127.0.0.1:3002/api/reporter/files", { method: "POST", body: form });
}
test("streamed TXT uploads are private, hashed, validated and preserve source text", async () => {
  const source = "Fonte local de teste. Não transmitir à Groq.";
  const file = await receiveFile(uploadRequest(source, "source.txt"));
  try {
    assert.equal(file.content, source); assert.equal(file.contentType, "text/plain");
    assert.equal(file.size, Buffer.byteLength(source)); assert.match(file.checksum, /^[a-f0-9]{64}$/);
    assert.equal(await sourcePath(file.id + ".source"), file.destination);
  } finally { await rm(file.destination); }
});
test("browser uploads preserve UTF-8 filenames and normalize decomposed macOS accents", async () => {
  const source = "Synthetic editorial source. Not sent to a provider.";
  for (const name of ["Podcast-Gestão-espécies-não.txt", "Podcast-Gestão-espécies-não.txt".normalize("NFD"), "Entrevista-東京.txt"]) {
    const file = await receiveFile(uploadRequest(source, name));
    try {
      assert.equal(file.name, name.normalize("NFC"));
      assert.doesNotMatch(file.name, /[\x00-\x1f\x7f-\x9f]/);
      assert.equal(file.content, source);
      assert.equal(file.size, Buffer.byteLength(source));
    } finally { await rm(file.destination); }
  }
});
test("malformed, oversized, unsupported and invalid UTF-8 uploads fail before intake", async () => {
  await assert.rejects(receiveFile(uploadRequest(new Uint8Array([0xff, 0xfe]), "invalid.txt")), /INVALID_TEXT_ENCODING/);
  await assert.rejects(receiveFile(uploadRequest(" ", "empty.txt")), /INVALID_TRANSCRIPT/);
  await assert.rejects(receiveFile(uploadRequest("text", "script.html")), /UNSUPPORTED_MEDIA/);
  await assert.rejects(receiveFile(uploadRequest("text", "invalid\u0083.txt")), /UNSUPPORTED_MEDIA/);
  await assert.rejects(receiveFile(uploadRequest("text", "source.txt", true)), /ONE_FILE_REQUIRED/);
  await assert.rejects(receiveFile(uploadRequest("a".repeat(1048577), "large.txt")), /TEXT_TOO_LARGE/);
  await assert.rejects(receiveFile(new Request("http://127.0.0.1:3002", { method: "POST", body: "invalid",
    headers: { "Content-Type": "multipart/form-data;" } })), /INVALID_MULTIPART/);
});
test("generation validates provider output and reuses a successful checkpoint", async () => {
  const directory = await mkdtemp(join(tmpdir(), "reporter-provider-test-"));
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    assert.equal(body.response_format.json_schema.strict, true);
    assert.ok(body.messages[0].content.includes("Não invente"));
    return Response.json({ id: "fixture-request", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ title: "Título fiel", content: "Texto baseado na fonte." }) } }], usage: { prompt_tokens: 100, completion_tokens: 20 } });
  };
  try {
    const one = await generateEditorial("article", "Fonte original", directory, new AbortController().signal, async () => {});
    const two = await generateEditorial("article", "Fonte original", directory, new AbortController().signal, async () => {});
    assert.equal(one.content, "Texto baseado na fonte.");
    assert.deepEqual(one, two); assert.equal(calls, 1); assert.equal(one.input_units, 100);
  } finally { globalThis.fetch = original; await rm(directory, { recursive: true, force: true }); }
});
test("provider rate limits honor Retry-After without exposing the response body", async () => {
  const directory = await mkdtemp(join(tmpdir(), "reporter-rate-test-"));
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("private response", { status: 429, headers: { "Retry-After": "120" } });
  try {
    await assert.rejects(generateEditorial("article", "Fonte", directory, new AbortController().signal, async () => {}),
      error => error instanceof FlowError && error.code === "GROQ_RATE_LIMIT" && error.retryable && error.waitSeconds === 120);
  } finally { globalThis.fetch = original; await rm(directory, { recursive: true, force: true }); }
});
test('a Groq validation failure is retryable but a bad input is not, without reflecting provider text', async () => {
  const original = globalThis.fetch;
  try {
    for (const [code,retryable] of [['json_validate_failed',true],['invalid_request_error',false]] as const) {
      globalThis.fetch = async () => Response.json({ error: { code,message: 'private provider text' } },{ status: 400 });
      await assert.rejects(generateStructured('Synthetic source','Test',{ type: 'object',properties: {},required: [],additionalProperties: false },new AbortController().signal),
        error => error instanceof FlowError && error.retryable === retryable && !error.message.includes('private') && error.code === (retryable ? 'GROQ_OUTPUT_RETRY' : 'GROQ_INPUT_REJECTED'));
    }
  } finally { globalThis.fetch = original; }
});
test("incomplete generations never become a ready draft", async () => {
  const directory = await mkdtemp(join(tmpdir(), "reporter-incomplete-test-"));
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ choices: [{ finish_reason: "length", message: { content: "{}" } }] });
  try {
    await assert.rejects(generateEditorial("article", "Fonte", directory, new AbortController().signal, async () => {}), /GENERATION_INCOMPLETE/);
  } finally { globalThis.fetch = original; await rm(directory, { recursive: true, force: true }); }
});
test("a checkpoint from a different model is not reused", async () => {
  const directory = await mkdtemp(join(tmpdir(), "reporter-model-test-"));
  await writeFile(join(directory, "result.json"), JSON.stringify({ model: "other-model", content: "old" }));
  const original = globalThis.fetch; let called = false;
  globalThis.fetch = async () => { called = true; return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ title: "New", content: "New content" }) } }] }); };
  try {
    const result = await generateEditorial("article", "Source", directory, new AbortController().signal, async () => {});
    assert.ok(called); assert.equal(result.content, "New content");
  } finally { globalThis.fetch = original; await rm(directory, { recursive: true, force: true }); }
});
