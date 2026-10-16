import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import ts from "typescript";
import { fail } from "./lib/command.mjs";

const MAX_DESCRIPTION_LENGTH = 140;
const MAX_EYEBROW_LENGTH = 40;
const MAX_HINT_LENGTH = 90;
const MAX_META_ITEMS = 2;

function attributeMap(attributes) {
  return new Map(
    attributes.properties
      .filter(ts.isJsxAttribute)
      .map((attribute) => [attribute.name.getText(), attribute]),
  );
}

function literalValue(attribute) {
  if (!attribute?.initializer) return undefined;
  if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer.text;
  if (!ts.isJsxExpression(attribute.initializer)) return undefined;

  const expression = attribute.initializer.expression;
  return expression && ts.isStringLiteral(expression) ? expression.text : undefined;
}

function inspectPageHeader(attributes, projectPath, violations) {
  const props = attributeMap(attributes);

  // Page navigation is the TopBar trail (breadcrumbs) only; no header back link.
  if (props.has("back")) {
    violations.push(`${projectPath}: PageHeader back is not used; the TopBar trail is the only page navigation`);
  }

  // A spread could carry `back` or stacked copy past this policy: header props are written out.
  if (attributes.properties.some(ts.isJsxSpreadAttribute)) {
    violations.push(`${projectPath}: PageHeader props are written out (no spread) so the content policy can read them`);
  }

  const supporting = ["eyebrow", "description", "meta"].filter((name) => props.has(name));

  if (supporting.length > 1) {
    violations.push(`${projectPath}: PageHeader uses ${supporting.join(", ")}; keep at most one supporting text layer`);
  }

  const description = literalValue(props.get("description"));
  if (description && description.length > MAX_DESCRIPTION_LENGTH) {
    violations.push(`${projectPath}: PageHeader description exceeds ${MAX_DESCRIPTION_LENGTH} characters`);
  }

  const eyebrow = literalValue(props.get("eyebrow"));
  if (eyebrow && eyebrow.length > MAX_EYEBROW_LENGTH) {
    violations.push(`${projectPath}: PageHeader eyebrow exceeds ${MAX_EYEBROW_LENGTH} characters`);
  }

  const meta = props.get("meta")?.initializer;
  if (meta && ts.isJsxExpression(meta) && meta.expression && ts.isArrayLiteralExpression(meta.expression)) {
    if (meta.expression.elements.length > MAX_META_ITEMS) {
      violations.push(`${projectPath}: PageHeader meta has more than ${MAX_META_ITEMS} items`);
    }
  }
}

export function contentDensityViolations(source, projectPath = "source.tsx") {
  const sourceFile = ts.createSourceFile(
    projectPath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const violations = [];
  // `import { PageHeader as Header }` is still the page header; so is `<DS.PageHeader>`.
  const headerNames = new Set(["PageHeader"]);
  for (const statement of sourceFile.statements) {
    const bindings = ts.isImportDeclaration(statement) ? statement.importClause?.namedBindings : undefined;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const specifier of bindings.elements) {
      if ((specifier.propertyName ?? specifier.name).text === "PageHeader") headerNames.add(specifier.name.text);
    }
  }

  function isPageHeader(tagName) {
    if (ts.isIdentifier(tagName)) return headerNames.has(tagName.text);
    return ts.isPropertyAccessExpression(tagName) && tagName.name.text === "PageHeader";
  }

  function visit(node) {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && isPageHeader(node.tagName)) {
      inspectPageHeader(node.attributes, projectPath, violations);
    }

    if (ts.isPropertyAssignment(node) && node.name.getText(sourceFile) === "hint") {
      const value = node.initializer;
      if (ts.isStringLiteral(value) && value.text.length > MAX_HINT_LENGTH) {
        violations.push(`${projectPath}: metric hint exceeds ${MAX_HINT_LENGTH} characters`);
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : [path];
  });
}

const invokedPath = process.argv[1] ? new URL(`file://${process.argv[1]}`).href : "";

if (import.meta.url === invokedPath) {
  const violations = sourceFiles(join(process.cwd(), "src"))
    .filter((path) => extname(path) === ".tsx")
    .flatMap((path) => contentDensityViolations(
      readFileSync(path, "utf8"),
      relative(process.cwd(), path),
    ));

  if (violations.length > 0) {
    fail(`content-density violations:\n- ${violations.join("\n- ")}`);
  }

  console.log("Content-density policy passed");
}
