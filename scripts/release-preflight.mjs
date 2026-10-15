import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { acceptEditorialFlow } from "./editorial-flow-acceptance.mjs";
// Same scenario as Neon, with real commands and worker; only external transports
// are fixtures. No .env is loaded and unexpected network requests are rejected.
test("release scenario reaches separate-user approvals, PNG export and delivery offline", async () => {
  const previousEnv = { ...process.env }, originalFetch = globalThis.fetch, previousCwd = process.cwd();
  const directory = await mkdtemp(join(tmpdir(), "reporter-offline-"));
  process.chdir(directory);
  const { validateExport }=await import("./neon-render-acceptance.mjs");
  const { editorialRpc, editorialWorkspace }=await import("../src/server/editorial.ts");
  const { runEditorialJob }=await import("../src/server/editorial-worker.ts");
  const { runWithReporterContext }=await import("../src/server/request-context.ts");
  const { createEditorialEngine }=await import("../src/runtime/editorial-engine.ts");
  const { analyzeMaterial }=await import("../src/server/material-analysis.ts");
  const { ATELIE_SUL_TRANSCRIPT }=await import("../src/fixtures/sources/atelie-sul.ts");
  const globals = globalThis;
  const previousPools = globals.reporterPools;
  process.env.REPORTER_DEPLOYMENT_MODE = "cloud";
  process.env.REPORTER_DEFAULT_PORTAL_ID = "10000000-0000-0000-0000-000000000101";
  process.env.REPORTER_GENERATION_MODEL = "openai/gpt-oss-120b";
  process.env.GROQ_API_KEY = "offline-placeholder";
  delete process.env.PIXABAY_API_KEY;
  const actors = Object.fromEntries([
    ["editor", ["editor"]],
    ["reviewer", ["approver", "creative_reviewer"]]
  ].map(([name, roles]) => [String(name), {
    tenant: "10000000-0000-0000-0000-000000000001",
    portal: process.env.REPORTER_DEFAULT_PORTAL_ID,
    actor: randomUUID(),
    email: name + "@example.invalid",
    name: String(name),
    workspaceName: "Acceptance",
    workspaceSlug: "reporter-ai",
    roles
  }]));
  let checkpoint = {}, revision = 0;
  const client = { release() {
  }, async query(sql, args = []) {
    if (sql.startsWith("SELECT status FROM public.reporter_transcripts")) return { rows: [{ status: "ready" }] };
    if (sql.includes("reporter_editorial_load")) return { rows: [{ value: { revision, checkpoint: structuredClone(checkpoint) } }] };
    if (sql.includes("reporter_editorial_save")) {
      assert.equal(args[0], revision);
      checkpoint = JSON.parse(args[1]);
      return { rows: [{ revision: ++revision }] };
    }
    if (sql.includes("reporter_editorial_status")) return { rows: [{ value: { revision, membersHash: "offline" } }] };
    if (sql.includes("reporter_editorial_pending")) return { rows: [{ pending: true }] };
    if (sql.includes("reporter_worker_online")) return { rows: [{ online: true }] };
    if (sql.includes("reporter_workspace_members")) return { rows: [{ members: Object.values(actors).map((a) => ({ workspaceId: a.portal, workspaceName: a.workspaceName, workspaceSlug: a.workspaceSlug, personId: a.actor, name: a.name, email: a.email, roles: a.roles })) }] };
    if (/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL|SELECT set_config)/.test(sql)) return { rows: [] };
    throw new Error("Unexpected offline database operation: " + sql);
  } };
  let tail = Promise.resolve();
  const connect = async () => {
    const previous = tail;
    let release;
    tail = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    return { query: client.query, release };
  };
  globals.reporterPools = { runtime: { connect }, worker: { connect } };
  const as = (who, fn) => runWithReporterContext(actors[who], fn);
  const rpc = async (who, method, ...args) => {
    const r = await as(who, () => editorialRpc({ method, args, requestId: randomUUID() }));
    assert.equal(r.ok, true, JSON.stringify(r));
    return r.value;
  };
  const snapshot = () => as("editor", () => editorialWorkspace());
  const record = async (id) => {
    const engine = createEditorialEngine(await snapshot(), { next: () => randomUUID() });
    try {
      return engine.records.record(id);
    } finally {
      engine.store.dispose();
    }
  };
  const calls = [], imageFiles = new Map();
  let revisions=0;
  const jsonAfter = (text, label) => JSON.parse(text.split(label)[1].trim().split("\n\n")[0]);
  globalThis.fetch = async (url, init) => {
    try {
      assert.equal(String(url), "https://api.groq.com/openai/v1/chat/completions", "Offline preflight forbids network");
      const input = JSON.parse(String(init?.body)), prompt = input.messages[1].content;
      const schema = input.response_format.json_schema.schema;
      let output;
      if (schema.properties.participants) {
        output = { title: "Material sintético", participants: [] };
        calls.push("material");
      } else if (schema.properties.facts) {
        output = { facts: [prompt.split("\n").find((s) => s.includes("[s")) ?? "Fonte sintética."] };
        calls.push("facts");
      } else if (schema.properties.introIds && schema.properties.sections) {
        const ids = schema.properties.introIds.items.enum;
        output = { title: "Artigo sintético de aceite", introIds: [ids[0]], sections: [0, 1, 2].map((i) => ({ title: "Seção " + (i + 1), evidenceIds: [ids[i + 1]] })) };
        calls.push("outline");
      } else if (schema.properties.sectionIds) {
        const outline = jsonAfter(prompt, "Outline:");
        output = { introIds: outline.introIds, sectionIds: outline.sections.map((s) => s.evidenceIds) };
        calls.push("quotes");
      } else if (schema.properties.paragraphs) {
        const section = prompt.startsWith("SEÇÃO"), sizing = jsonAfter(prompt, section ? "Orçamento:" : "Orçamento e limites:");
        const selection = jsonAfter(prompt, section ? "Seção atual:" : "Estrutura aprovada:");
        const source = jsonAfter(prompt, "Fonte com evidências [id]:");
        const id = (section ? selection.evidenceIds : selection.introIds)[0];
        const evidence = source.literalEvidence.find((e) => e.id === id);
        const quote = evidence.text.split(/(?<=[.!?])\s+/)[0];
        const text = "Na fonte a equipe trata de um fato e cita os dados do caso. ".repeat(11) + (section ? " A fonte diz: “" + quote + "”" : "");
        assert.ok(text.length <= sizing.maxChars, "Synthetic part must fit the real budget");
        if(sizing.revisionFeedback){
          revisions++;
          assert.equal(section?sizing.currentSection.budgetChars:sizing.introChars,sizing.targetChars);
          assert.equal(sizing.revisionFeedback.targetTotalChars,sizing.targetChars);
        }
        output = { ...(section ? { title: selection.title } : {}), paragraphs: [
          { text: sizing.revisionFeedback?text.trim():text.repeat(5).trim(), evidenceIds: [id] }
        ] };
        calls.push(section ? "section" : "intro");
      } else if (schema.properties.cover) {
        const body=jsonAfter(prompt,"Artigo redigido com ids dos blocos:");
        const id=body.blocks.find(block=>block.type==='paragraph').id;
        const suggestion={subject:'Imagem sintética',suggestedCaption:'Ilustração',suggestedAlt:'Imagem de teste',orientation:'landscape',sourceBlockIds:[id]};
        output = { cover: suggestion, figures: [{...suggestion,afterBlockId:id}] };
        calls.push("images");
      } else if (schema.properties.slides) {
        const article = jsonAfter(prompt, "Artigo aprovado:");
        const block = article.blocks.find((b) => b.type === "paragraph");
        output = { slides: Object.fromEntries(Object.entries(schema.properties.slides.properties).map(([index, rule]) => [index, { slots: Object.fromEntries(Object.entries(rule.properties.slots.properties).map(([key, s]) => [key, (s.pattern ? "Fato da fonte." : "Fonte").slice(0, s.maxLength)])), sourceBlockIds: [block.id] }])) };
        calls.push("carousel");
      } else throw new Error("Unknown offline provider schema");
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(output) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    } catch (error) {
      console.error(error);
      throw error;
    }
  };
  try {
    await acceptEditorialFlow({
      rpc,
      snapshot,
      record,
      reviewerId: actors.reviewer.actor,
      transcriptId: randomUUID(),
      sourceText: "1\n00:00:00,000 --> 00:10:00,000\n" + ATELIE_SUL_TRANSCRIPT.replace(/\n\n/g, "\n"),
      analyzeMaterial: (...args) => as("editor", () => analyzeMaterial(...args)),
      waitRun: async (id) => {
        await runEditorialJob("offline-preflight", new AbortController().signal);
        const s = await snapshot();
        assert.equal(s.state.runFolds[id].run.status, "completed", JSON.stringify(s.state.runFolds[id].run.error));
      },
      uploadImage: async (productionId) => {
        const bytes = await sharp({ create: { width: 2400, height: 1350, channels: 3, background: "#667788" } }).png().toBuffer();
        const id = randomUUID();
        imageFiles.set(id, bytes);
        checkpoint.imageAssets = [{ asset: { id, workspaceId: actors.editor.portal, productionId, createdBy: actors.editor.actor, createdAt: (new Date()).toISOString(), fileName: "offline.png", mime: "image/png", bytes: bytes.length, width: 2400, height: 1350, kind: "image", origin: { type: "upload", fileName: "offline.png" }, rights: { authorized: true }, credit: "Synthetic" }, fileKey: "offline.image" }];
        return checkpoint.imageAssets[0].asset;
      },
      validateExport: (state, id) => as("editor", () => validateExport(state, id, async (assetId) => {
        assert.ok(imageFiles.has(assetId));
        return new Response(imageFiles.get(assetId), { headers: { "content-type": "image/png" } });
      }))
    });
    assert.equal(calls.filter((c) => c === "carousel").length, 1);
    assert.equal(calls.filter((c) => c === "outline").length, 3);
    assert.equal(checkpoint.state.productions.length, 3);
    assert.equal(revisions,12,"Every article part exercised measured revision");
  } finally {
    globalThis.fetch = originalFetch;
    globals.reporterPools = previousPools;
    process.chdir(previousCwd);
    await rm(directory, { recursive: true, force: true });
    for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
    Object.assign(process.env, previousEnv);
  }
});
