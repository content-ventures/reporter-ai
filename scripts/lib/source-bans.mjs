import ts from "typescript";

const NODE_VIEW_IDENTIFIERS = new Set(["ReactNodeViewRenderer", "NodeViewWrapper", "NodeViewContent"]);
const DOM_FACTORIES = new Set(["createElement", "createElementNS", "createTextNode", "createDocumentFragment"]);
const DOCUMENT_RECEIVER = /(^|\.)(document|ownerDocument)$/;
const STYLE_MUTATORS = new Set(["setProperty", "removeProperty"]);
const HTML_SINKS = new Set(["innerHTML", "outerHTML"]);
const CLASS_MUTATORS = new Set(["add", "remove", "toggle", "replace"]);

const MESSAGES = {
  computedStyle: "getComputedStyle is not permitted; consume Design System components instead of resolving CSS values",
  nodeView: "TipTap node views are not permitted; the editor is logic only and document styling comes from the Design System Prose component",
  innerHtml: "dangerouslySetInnerHTML is not permitted; render serializable blocks through Design System components",
  styleString: "strings containing <style are not permitted; exports and documents must not carry local styling",
  styleMutation: "imperative style mutation is not permitted; styling belongs to the Design System",
  domCreation: "DOM creation is not permitted in product code; DOM factories belong to the Design System",
  inlineStyle: "inline visual styles are not permitted",
  literalClass: "literal CSS classes are not permitted; compose public Design System components",
};

function scriptKind(projectPath) {
  if (/\.(tsx|jsx)$/.test(projectPath)) return ts.ScriptKind.TSX;
  if (/\.(js|mjs|cjs)$/.test(projectPath)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function isTestFile(projectPath) {
  return /\.test\.[cm]?[jt]sx?$/.test(projectPath);
}

function hasStringLiteral(node) {
  if (!node) return false;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) return true;
  if (ts.isFunctionLike(node)) return false;
  return Boolean(ts.forEachChild(node, (child) => hasStringLiteral(child) || undefined));
}

function propertyName(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return node.argumentExpression.text;
  }
  return undefined;
}

/** True for `x.style`, `x.style.color`, `x.style["color"]` and deeper chains through `.style`. */
function touchesStyle(node) {
  let current = node;
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    if (propertyName(current) === "style") return true;
    current = current.expression;
  }
  return false;
}

function isAssignment(node) {
  return ts.isBinaryExpression(node)
    && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
    && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
}

function isLowercaseTag(node) {
  return node && ts.isStringLiteralLike(node) && /^[a-z]/.test(node.text);
}

/**
 * Bans that keep product code inside the Design System contract: no resolved CSS values,
 * no editor node views, no HTML injection, no local styling strings or mutations and no DOM creation.
 */
export function sourceBanViolations(source, projectPath = "source.tsx") {
  const sourceFile = ts.createSourceFile(projectPath, source, ts.ScriptTarget.Latest, true, scriptKind(projectPath));
  const linesByMessage = new Map();
  const testFile = isTestFile(projectPath);

  function report(node, message) {
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    const lines = linesByMessage.get(message) ?? new Set();
    linesByMessage.set(message, lines.add(line));
  }

  function inspectCall(node) {
    const callee = node.expression;
    const name = ts.isIdentifier(callee) ? callee.text : propertyName(callee);

    if (ts.isPropertyAccessExpression(callee)) {
      const receiver = callee.expression.getText(sourceFile);

      if (DOM_FACTORIES.has(name) && DOCUMENT_RECEIVER.test(receiver)) {
        report(node, MESSAGES.domCreation);
      } else if (name === "createElement" && isLowercaseTag(node.arguments[0])) {
        report(node, `local <${node.arguments[0].text}> markup through createElement is not permitted; use a public Design System component`);
      }

      if (name === "insertAdjacentHTML") report(node, MESSAGES.domCreation);
      if (CLASS_MUTATORS.has(name) && propertyName(callee.expression) === "classList") report(node, MESSAGES.literalClass);
      if (STYLE_MUTATORS.has(name) && touchesStyle(callee.expression)) report(node, MESSAGES.styleMutation);

      if (name === "setAttribute" && ts.isStringLiteralLike(node.arguments[0])) {
        const attribute = node.arguments[0].text.toLowerCase();
        if (attribute === "style") report(node, MESSAGES.styleMutation);
        if (attribute === "class") report(node, MESSAGES.literalClass);
      }

      if (name === "assign" && receiver === "Object" && node.arguments[0] && touchesStyle(node.arguments[0])) {
        report(node, MESSAGES.styleMutation);
      }
    } else if (name === "createElement" && isLowercaseTag(node.arguments[0])) {
      report(node, `local <${node.arguments[0].text}> markup through createElement is not permitted; use a public Design System component`);
    }
  }

  function inspectAssignment(node) {
    const target = node.left;
    if (touchesStyle(target)) report(node, MESSAGES.styleMutation);

    const name = propertyName(target);
    if (HTML_SINKS.has(name)) report(node, MESSAGES.domCreation);
    if (name === "className") report(node, MESSAGES.literalClass);
    if (ts.isIdentifier(target) && target.text === "className" && hasStringLiteral(node.right)) {
      report(node, MESSAGES.literalClass);
    }
  }

  function inspectJsxAttribute(node) {
    const name = node.name.getText(sourceFile);

    if (name === "dangerouslySetInnerHTML") report(node, MESSAGES.innerHtml);
    if (name === "style") report(node, MESSAGES.inlineStyle);

    if (name === "className" && node.initializer) {
      const literal = ts.isStringLiteral(node.initializer)
        || (ts.isJsxExpression(node.initializer) && hasStringLiteral(node.initializer.expression));
      if (literal) report(node, MESSAGES.literalClass);
    }
  }

  function visit(node) {
    if (ts.isCallExpression(node)) inspectCall(node);
    if (isAssignment(node)) inspectAssignment(node);
    if (ts.isJsxAttribute(node)) inspectJsxAttribute(node);

    if (ts.isIdentifier(node) && NODE_VIEW_IDENTIFIERS.has(node.text)) report(node, MESSAGES.nodeView);
    if (ts.isIdentifier(node) && node.text === "getComputedStyle") report(node, MESSAGES.computedStyle);

    if ((ts.isMethodDeclaration(node) || ts.isPropertyAssignment(node)) && node.name.getText(sourceFile) === "addNodeView") {
      report(node, MESSAGES.nodeView);
    }

    if (
      (ts.isPropertyAssignment(node) || ts.isPropertyDeclaration(node))
      && node.name.getText(sourceFile) === "dangerouslySetInnerHTML"
    ) {
      report(node, MESSAGES.innerHtml);
    }

    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.name.text === "className"
      && node.initializer
      && hasStringLiteral(node.initializer)
    ) {
      report(node, MESSAGES.literalClass);
    }

    if (
      !testFile
      && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateLiteralToken(node))
      && /<style\b/i.test(node.text)
    ) {
      report(node, MESSAGES.styleString);
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return [...linesByMessage].map(([message, lines]) => `${projectPath}:${[...lines].join(",")}: ${message}`);
}

export function lowercaseMarkupViolations(source, projectPath = "source.tsx", allowedElements = new Set()) {
  const sourceFile = ts.createSourceFile(projectPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const elements = new Set();

  function collect(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const name = node.tagName.getText(sourceFile);
      if (/^[a-z]/.test(name)) elements.add(name);
    }
    ts.forEachChild(node, collect);
  }

  collect(sourceFile);

  return [...elements]
    .filter((element) => !allowedElements.has(element))
    .map((element) => `${projectPath}: local <${element}> markup is not permitted; use a public Design System component`);
}
