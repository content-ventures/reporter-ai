import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { architectureViolations } from "./lib/architecture.mjs";
import { fail } from "./lib/command.mjs";

const SCRIPT_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

export function projectFiles(root = process.cwd()) {
  const sourceRoot = join(root, "src");
  if (!existsSync(sourceRoot)) return [];

  return walk(sourceRoot)
    .filter((path) => SCRIPT_EXTENSIONS.has(extname(path)))
    .map((path) => ({
      path: relative(root, path).split(sep).join("/"),
      source: readFileSync(path, "utf8"),
    }));
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";

if (import.meta.url === invokedPath) {
  const files = projectFiles();
  const violations = architectureViolations(files);

  if (violations.length > 0) {
    fail(`architecture violations (${violations.length}):\n- ${violations.join("\n- ")}`);
  }

  console.log(`Architecture policy passed for ${files.length} source files`);
}
