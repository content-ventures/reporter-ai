import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { LOCAL_FLOW } from "./lib/migrations.mjs";
import { migrationBody } from './lib/migration-body.mjs';

export const root = fileURLToPath(new URL("../", import.meta.url));
// A second checkout (another worktree) runs its own isolated database by naming a distinct
// project and port; the defaults keep the original single local database unchanged.
const project = process.env.REPORTER_DB_PROJECT?.trim() || "reporter-ai-local";
export const port = Number(process.env.REPORTER_DB_PORT?.trim() || 55432);
if (!/^reporter-ai-local(?:-[a-z0-9]+)*$/.test(project)) throw new Error("REPORTER_DB_PROJECT must start with reporter-ai-local");
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("REPORTER_DB_PORT must be a TCP port from 1024 to 65535");
const composeFile = resolve(root, "compose.reporter.yaml");
const envFile = resolve(root, ".env.reporter-db");
// Docker Desktop uses `desktop-linux` on the developer machine. GitHub-hosted runners expose
// Docker through the standard `default` context instead. Keeping this decision explicit prevents
// local commands from ever falling back to another project's daemon configuration.
export const context = process.env.CI ? "default" : "desktop-linux";
const command = process.argv[2] ?? "status";
const supported = ["up", "status", "stop", "psql", "test", "migrate", "flow"];

export function docker(args, options = {}) {
  const env = { ...process.env };
  delete env.DOCKER_HOST;
  delete env.DOCKER_CONTEXT;
  // Compose must read only this project's credentials, not another app's env.
  for (const key of Object.keys(env)) if (key.startsWith("REPORTER_")) delete env[key];
  env.REPORTER_DB_PORT = String(port);
  const result = spawnSync("docker", ["--context", context, ...args], {
    cwd: root, env, encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "Docker command failed");
  return result.stdout;
}

function compose(args, options) {
  return docker(["compose", "--project-name", project, "--env-file", envFile,
    "--file", composeFile, ...args], options);
}

export function container() {
  const ids = docker(["ps", "-aq", "--filter", "label=com.docker.compose.project=" + project,
    "--filter", "label=com.docker.compose.service=postgres"]).trim().split("\n").filter(Boolean);
  if (ids.length === 0) return null;
  if (ids.length !== 1) throw new Error("Multiple Reporter databases found; refusing ambiguous target");
  const [info] = JSON.parse(docker(["inspect", ids[0]]));
  const labels = info.Config.Labels ?? {};
  const files = (labels["com.docker.compose.project.config_files"] ?? "").split(",");
  if (!files.includes(composeFile) || info.Config.Env.indexOf("POSTGRES_DB=reporter_ai_local") === -1)
    throw new Error("Reporter container belongs to another checkout/configuration; refusing access");
  const volume = info.Mounts.find((mount) => mount.Destination === "/var/lib/postgresql/data");
  if (volume?.Type !== "volume" || volume.Name !== project + "_postgres_data")
    throw new Error("Unexpected database volume; refusing access");
  const networks = Object.keys(info.NetworkSettings.Networks ?? {});
  if (networks.length !== 1 || networks[0] !== project + "_reporter")
    throw new Error("Unexpected database network; refusing access");
  return ids[0];
}

export function sql(user, query, { database = "reporter_ai_local", tuples = true } = {}) {
  if (!["reporter_admin", "reporter_runtime", "reporter_worker"].includes(user))
    throw new Error("Unsupported Reporter role");
  if (database !== "reporter_ai_local") throw new Error("Database is outside Reporter local scope");
  const id = container();
  if (!id) throw new Error("Reporter database is not running. Run pnpm db:up");
  return docker(["exec", "-i", id, "psql", "-X", "-v", "ON_ERROR_STOP=1",
    "-U", user, "-d", database, ...(tuples ? ["-At"] : [])], { input: query });
}

async function validate() {
  if (!docker(["context", "inspect", context, "--format", "{{.Endpoints.docker.Host}}"]).trim().startsWith("unix://"))
    throw new Error("Only a local Docker Desktop Unix socket is allowed");
  docker(["info", "--format", "{{.ServerVersion}}"]);
  const contents = await readFile(envFile, "utf8").catch(() => {
    throw new Error("Create .env.reporter-db from .env.reporter-db.example with three unique local passwords");
  });
  const values = [...contents.matchAll(/^REPORTER_(POSTGRES|RUNTIME|WORKER)_PASSWORD=([a-zA-Z0-9_.-]{24,128})$/gm)];
  if (values.length !== 3 || new Set(values.map((entry) => entry[1])).size !== 3
    || new Set(values.map((entry) => entry[2])).size !== 3
    || values.some((entry) => entry[2].startsWith("replace-")))
    throw new Error("Set three distinct local passwords of 24–128 safe characters");
  compose(["config", "--quiet"]);
  // Existing project resources must belong to this configuration and use only scoped names.
  container();
  for (const [kind, name] of [["volume", project + "_postgres_data"], ["network", project + "_reporter"]]) {
    const found = docker([kind, "ls", "--filter", "name=^" + name + "$", "--format", "{{.Name}}"]).trim();
    if (!found) continue;
    const [resource] = JSON.parse(docker([kind, "inspect", name]));
    if (resource.Labels?.["com.docker.compose.project"] !== project)
      throw new Error("Resource name collision: " + name);
  }
}

async function portIsFree() {
  await new Promise((accept, reject) => {
    const server = createServer();
    server.once("error", () => reject(new Error(`Port ${port} is occupied; no existing service will be stopped`)));
    server.listen(port, "127.0.0.1", () => server.close(accept));
  });
}

export async function main() {
  if (!supported.includes(command)) throw new Error("Use up, status, stop, psql, test, migrate or flow. Destructive commands are not supported");
  await validate();
  if (command === "up") {
    const existing = container();
    const running = existing && docker(["inspect", existing, "--format", "{{.State.Running}}"]).trim() === "true";
    if (!running) await portIsFree();
    compose(["up", "--detach", "--wait", "--wait-timeout", "90", "postgres"], { stdio: "inherit" });
    console.log(`Reporter PostgreSQL ready: 127.0.0.1:${port} / reporter_ai_local. Credentials: .env.reporter-db`);
  } else if (command === "flow") {
    const bodies = [];
    for (const path of LOCAL_FLOW) bodies.push(migrationBody(await readFile(resolve(root, path), "utf8")));
    sql('reporter_admin','BEGIN;\n'+bodies.join('\n')+'\nCOMMIT;');
    console.log("Reporter local-flow migration applied. Existing data preserved.");
  } else if (command === "migrate") {
    const source = await readFile(resolve(root, "database/migrations/002-standalone.sql"), "utf8");
    sql("reporter_admin", source);
    console.log("Reporter standalone migration applied. Existing data and credentials preserved.");
  } else if (command === "stop") {
    compose(["stop", "postgres"], { stdio: "inherit" });
    console.log("Only Reporter stopped. Database volume preserved.");
  } else if (command === "status") {
    compose(["ps", "--all"], { stdio: "inherit" });
  } else if (command === "psql") {
    const id = container();
    if (!id) throw new Error("Run pnpm db:up first");
    docker(["exec", "-it", id, "psql", "-X", "-U", "reporter_admin", "-d", "reporter_ai_local"], { stdio: "inherit" });
  } else {
    const { runIntegration } = await import("./reporter-db-integration.mjs");
    await runIntegration();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
