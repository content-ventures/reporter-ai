import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { fail } from "./lib/command.mjs";
import { designSystemCompositionViolations } from "./lib/design-system-composition.mjs";
import { lowercaseMarkupViolations, sourceBanViolations } from "./lib/source-bans.mjs";

const SCRIPT_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const JSX_EXTENSIONS = new Set([".tsx", ".jsx"]);
const PUBLIC_DESIGN_SYSTEM = new Set([
  "@content-ventures/design-system/v3",
  "@content-ventures/design-system/v3/icons",
]);
const EXTERNAL_VISUAL_LIBRARY = /^(lucide-react|@mui\/|@chakra-ui\/|antd$|react-icons\/|@radix-ui\/)/;

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function importViolations(content, projectPath) {
  const violations = [];
  const imports = [...content.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((match) => match[1]);

  for (const importedPath of new Set(imports)) {
    if (importedPath.startsWith("@content-ventures/design-system") && !PUBLIC_DESIGN_SYSTEM.has(importedPath)) {
      violations.push(`${projectPath}: use only the public Design System V3 API (found ${importedPath})`);
    }

    if (EXTERNAL_VISUAL_LIBRARY.test(importedPath)) {
      violations.push(`${projectPath}: external visual library ${importedPath} is not permitted`);
    }
  }

  return violations;
}

export function fileViolations(projectPath, content) {
  const extension = extname(projectPath);

  if (projectPath.endsWith(".module.css")) {
    return [`${projectPath}: local CSS Modules are not permitted while the Design System can express the UI`];
  }

  if (extension === ".css") {
    return /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|--[a-z0-9-]+\s*:/i.test(content)
      ? [`${projectPath}: local colors or design tokens are not permitted`]
      : [];
  }

  if (!SCRIPT_EXTENSIONS.has(extension)) return [];

  const violations = [...importViolations(content, projectPath), ...sourceBanViolations(content, projectPath)];

  if (JSX_EXTENSIONS.has(extension)) {
    const allowedElements = projectPath === "src/app/layout.tsx" ? new Set(["html", "body"]) : new Set();
    violations.push(...lowercaseMarkupViolations(content, projectPath, allowedElements));
    violations.push(...designSystemCompositionViolations(content, projectPath));
  }

  return violations;
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";

if (import.meta.url === invokedPath) {
  const sourceFiles = walk(join(process.cwd(), "src"));
  const violations = sourceFiles.flatMap((path) => fileViolations(
    relative(process.cwd(), path).split(sep).join("/"),
    readFileSync(path, "utf8"),
  ));

  if (violations.length > 0) {
    fail(`Design System policy violations (${violations.length}):\n- ${violations.join("\n- ")}`);
  }

  console.log(`Design System policy passed for ${sourceFiles.length} source files`);
}
