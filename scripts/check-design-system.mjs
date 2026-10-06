import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { designSystemCompositionViolations } from "./lib/design-system-composition.mjs";
import { fail } from "./lib/command.mjs";

const sourceRoot = join(process.cwd(), "src");
const sourceFiles = [];

function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      walk(path);
    } else {
      sourceFiles.push(path);
    }
  }
}

walk(sourceRoot);

const violations = [];

for (const path of sourceFiles) {
  const projectPath = relative(process.cwd(), path);
  const extension = extname(path);
  const content = readFileSync(path, "utf8");

  if (path.endsWith(".module.css")) {
    violations.push(`${projectPath}: local CSS Modules are not permitted while the Design System can express the UI`);
  }

  if (extension === ".css") {
    if (/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|--[a-z0-9-]+\s*:/i.test(content)) {
      violations.push(`${projectPath}: local colors or design tokens are not permitted`);
    }

    continue;
  }

  if (![".ts", ".tsx"].includes(extension)) {
    continue;
  }

  const imports = [...content.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);

  for (const importedPath of imports) {
    if (
      importedPath.startsWith("@content-ventures/design-system") &&
      importedPath !== "@content-ventures/design-system/v3" &&
      importedPath !== "@content-ventures/design-system/v3/icons"
    ) {
      violations.push(`${projectPath}: use only the public Design System V3 API (found ${importedPath})`);
    }

    if (/^(lucide-react|@mui\/|@chakra-ui\/|antd$|react-icons\/|@radix-ui\/)/.test(importedPath)) {
      violations.push(`${projectPath}: external visual library ${importedPath} is not permitted`);
    }
  }

  if (/style\s*=\s*\{\{/.test(content)) {
    violations.push(`${projectPath}: inline visual styles are not permitted`);
  }

  if (/className\s*=\s*["']/.test(content)) {
    violations.push(`${projectPath}: literal CSS classes are not permitted; compose public Design System components`);
  }

  if (extension === ".tsx") {
    const allowedElements = projectPath === "src/app/layout.tsx" ? new Set(["html", "body"]) : new Set();
    const elements = [...content.matchAll(/<([a-z][a-z0-9-]*)(?:\s|>)/g)].map((match) => match[1]);

    for (const element of new Set(elements)) {
      if (!allowedElements.has(element)) {
        violations.push(`${projectPath}: local <${element}> markup is not permitted; use a public Design System component`);
      }
    }

    violations.push(...designSystemCompositionViolations(content, projectPath));
  }
}

if (violations.length > 0) {
  fail(`Design System policy violations:\n- ${violations.join("\n- ")}`);
}

console.log(`Design System policy passed for ${sourceFiles.length} source files`);
