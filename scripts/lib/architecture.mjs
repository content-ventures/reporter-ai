import { posix } from "node:path";
import ts from "typescript";

/** Layers whose modules stay framework-free and must be runnable by `node --test`. */
const PURE_LAYERS = new Set(["domain", "ports"]);
const NODE_TESTED_LAYERS = new Set(["domain", "ports", "adapters", "fixtures", "registries", "runtime"]);
const SIMULATION_LAYERS = new Set(["adapters", "fixtures"]);
const UI_LAYERS = new Set(["app", "components", "editor", "features", "modules", "state", "ui"]);
const TEST_TOOLING = new Set(["node:test", "node:assert", "node:assert/strict"]);
const NODE_RUNNABLE_EXTENSIONS = /\.(ts|json)$/;

export function isTestFile(projectPath) {
  return /\.test\.[cm]?[jt]sx?$/.test(projectPath);
}

function isContractSuite(projectPath) {
  return projectPath.startsWith("src/ports/") && /\.contract\.ts$/.test(projectPath);
}

/** `src/<layer>/...` → layer name; anything outside `src/` has no layer. */
export function layerOf(projectPath) {
  const match = /^src\/([^/]+)\//.exec(projectPath);
  return match ? match[1] : undefined;
}

function isLayoutProvider(projectPath) {
  return /^src\/app\/(?:.+\/)?(layout|providers?)\.tsx?$/.test(projectPath);
}

function scriptKind(projectPath) {
  return /\.(tsx|jsx)$/.test(projectPath) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

/** Every static module reference: imports, re-exports, `import()` types and calls, and `require()`. */
export function moduleReferences(source, projectPath) {
  const sourceFile = ts.createSourceFile(projectPath, source, ts.ScriptTarget.Latest, true, scriptKind(projectPath));
  const references = [];

  function add(literal) {
    if (literal && ts.isStringLiteralLike(literal)) {
      const line = sourceFile.getLineAndCharacterOfPosition(literal.getStart(sourceFile)).line + 1;
      references.push({ specifier: literal.text, line });
    }
  }

  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node.moduleReference.expression);
    }
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) add(node.argument.literal);
    if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      if (isDynamicImport || isRequire) add(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return references;
}

/** Resolves relative and `@/` specifiers to a project path; bare specifiers stay external. */
export function resolveSpecifier(specifier, fromPath) {
  if (specifier.startsWith("@/")) return { kind: "alias", path: posix.join("src", specifier.slice(2)) };
  if (specifier.startsWith(".")) return { kind: "relative", path: posix.normalize(posix.join(posix.dirname(fromPath), specifier)) };
  return { kind: "external", path: undefined };
}

function pureLayerViolations(file, reference, target) {
  const test = isTestFile(file.path);
  const where = `${file.path}:${reference.line}`;

  if (target.kind === "external") {
    const allowed = test ? reference.specifier.startsWith("node:") : isContractSuite(file.path) && TEST_TOOLING.has(reference.specifier);
    return allowed ? [] : [`${where}: src/domain and src/ports are pure TypeScript; external module ${reference.specifier} is not permitted`];
  }

  if (target.kind === "alias") return [`${where}: src/domain and src/ports use relative .ts imports; replace ${reference.specifier}`];

  if (!test && !PURE_LAYERS.has(layerOf(target.path))) {
    return [`${where}: src/domain and src/ports may import only modules inside src/domain or src/ports (found ${reference.specifier})`];
  }

  return [];
}

function nodeRunnableViolations(file, reference, target) {
  const where = `${file.path}:${reference.line}`;
  if (target.kind === "alias") {
    return [`${where}: ${reference.specifier} cannot be resolved by node --test; use a relative import with the .ts extension`];
  }
  if (target.kind === "relative" && !NODE_RUNNABLE_EXTENSIONS.test(reference.specifier)) {
    return [`${where}: relative import ${reference.specifier} must include the .ts extension so node --test can run it`];
  }
  return [];
}

function dependencyViolations(file, reference, target) {
  if (target.kind === "external") return [];

  const where = `${file.path}:${reference.line}`;
  const sourceLayer = layerOf(file.path);
  const targetLayer = layerOf(target.path);
  const test = isTestFile(file.path);

  if (SIMULATION_LAYERS.has(targetLayer) && sourceLayer !== targetLayer && sourceLayer !== "runtime" && !test) {
    return UI_LAYERS.has(sourceLayer)
      ? [`${where}: UI code must never import src/${targetLayer}; read data through src/state`]
      : [`${where}: src/${targetLayer} may be imported only by src/runtime and tests`];
  }

  if (targetLayer === "runtime" && sourceLayer !== "runtime" && sourceLayer !== "state" && !test && !isLayoutProvider(file.path)) {
    return [`${where}: src/runtime may be imported only by src/state and app layout providers`];
  }

  return [];
}

/**
 * Checks the layering contract for project files given as `{ path, source }`,
 * where `path` is a POSIX path relative to the repository root.
 */
export function architectureViolations(files) {
  const violations = [];

  for (const file of files) {
    const layer = layerOf(file.path);
    const pure = PURE_LAYERS.has(layer);
    const nodeTested = NODE_TESTED_LAYERS.has(layer) && /\.[cm]?ts$/.test(file.path);

    if (pure && !/\.ts$/.test(file.path)) {
      violations.push(`${file.path}: src/domain and src/ports contain only framework-free .ts modules`);
    }

    for (const reference of moduleReferences(file.source, file.path)) {
      const target = resolveSpecifier(reference.specifier, file.path);

      if (pure) violations.push(...pureLayerViolations(file, reference, target));
      if (nodeTested && !(pure && target.kind === "alias")) violations.push(...nodeRunnableViolations(file, reference, target));
      violations.push(...dependencyViolations(file, reference, target));
    }
  }

  return [...new Set(violations)];
}
