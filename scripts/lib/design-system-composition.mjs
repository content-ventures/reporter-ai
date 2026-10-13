import ts from "typescript";

const FRAGMENT_TAGS = new Set(["Fragment", "React.Fragment"]);
const EMPTY = Object.freeze({ canBeEmpty: true, startsOpen: false, endsOpen: false, adjacent: false });
const OPAQUE = Object.freeze({ canBeEmpty: false, startsOpen: false, endsOpen: false, adjacent: false });
const OPEN_SECTION = Object.freeze({ canBeEmpty: false, startsOpen: true, endsOpen: true, adjacent: false });

function tagName(element, sourceFile) {
  if (ts.isJsxElement(element)) {
    return element.openingElement.tagName.getText(sourceFile);
  }

  if (ts.isJsxSelfClosingElement(element)) {
    return element.tagName.getText(sourceFile);
  }

  return undefined;
}

function attributesOf(element) {
  return ts.isJsxElement(element) ? element.openingElement.attributes : element.attributes;
}

function findAttribute(element, name, sourceFile) {
  return attributesOf(element).properties.find(
    (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(sourceFile) === name,
  );
}

function unwrap(expression) {
  let current = expression;
  while (current && ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

function visualChildren(element) {
  return element.children.filter(
    (child) => ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child),
  );
}

/** True when any statically known value of the expression can be the literal "open". */
function mayBeOpenVariant(expression) {
  const value = unwrap(expression);
  if (!value) return false;
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text === "open";
  if (ts.isConditionalExpression(value)) return mayBeOpenVariant(value.whenTrue) || mayBeOpenVariant(value.whenFalse);
  return false;
}

function isOpenSection(element, sourceFile) {
  const variant = findAttribute(element, "variant", sourceFile);
  if (!variant) return true;
  if (!variant.initializer) return false;
  if (ts.isStringLiteral(variant.initializer)) return variant.initializer.text === "open";
  if (ts.isJsxExpression(variant.initializer)) return mayBeOpenVariant(variant.initializer.expression);
  return false;
}

function union(left, right) {
  return {
    canBeEmpty: left.canBeEmpty || right.canBeEmpty,
    startsOpen: left.startsOpen || right.startsOpen,
    endsOpen: left.endsOpen || right.endsOpen,
    adjacent: left.adjacent || right.adjacent,
  };
}

function sequence(items) {
  return items.reduce((before, item) => ({
    canBeEmpty: before.canBeEmpty && item.canBeEmpty,
    startsOpen: before.startsOpen || (before.canBeEmpty && item.startsOpen),
    endsOpen: item.endsOpen || (item.canBeEmpty && before.endsOpen),
    adjacent: before.adjacent || item.adjacent || (before.endsOpen && item.startsOpen),
  }), EMPTY);
}

/**
 * Summarizes what a JSX child can render as direct DOM siblings of a PageStack:
 * whether it may start or end with an open Section and whether two open Sections
 * may end up adjacent inside it. Conditional branches are alternatives, never summed.
 */
function renderedSummary(node, sourceFile) {
  if (!node) return EMPTY;

  if (ts.isJsxText(node)) return node.containsOnlyTriviaWhiteSpaces ? EMPTY : OPAQUE;
  if (ts.isJsxFragment(node)) return sequence(node.children.map((child) => renderedSummary(child, sourceFile)));

  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
    const name = tagName(node, sourceFile);
    if (name === "Section") return isOpenSection(node, sourceFile) ? OPEN_SECTION : OPAQUE;
    if (FRAGMENT_TAGS.has(name) && ts.isJsxElement(node)) {
      return sequence(node.children.map((child) => renderedSummary(child, sourceFile)));
    }
    return OPAQUE;
  }

  if (ts.isJsxExpression(node)) return node.expression ? renderedSummary(node.expression, sourceFile) : EMPTY;
  if (ts.isParenthesizedExpression(node)) return renderedSummary(node.expression, sourceFile);

  if (node.kind === ts.SyntaxKind.NullKeyword || node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) {
    return EMPTY;
  }
  if (ts.isIdentifier(node) && node.text === "undefined") return EMPTY;

  if (ts.isConditionalExpression(node)) {
    return union(renderedSummary(node.whenTrue, sourceFile), renderedSummary(node.whenFalse, sourceFile));
  }

  if (ts.isBinaryExpression(node)) {
    const operator = node.operatorToken.kind;
    if (operator === ts.SyntaxKind.AmpersandAmpersandToken) return union(EMPTY, renderedSummary(node.right, sourceFile));
    if (operator === ts.SyntaxKind.BarBarToken || operator === ts.SyntaxKind.QuestionQuestionToken) {
      return union(renderedSummary(node.left, sourceFile), renderedSummary(node.right, sourceFile));
    }
    return OPAQUE;
  }

  if (ts.isArrayLiteralExpression(node)) {
    return sequence(node.elements.map((element) => renderedSummary(element, sourceFile)));
  }

  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    const method = node.expression.name.text;
    if ((method === "map" || method === "flatMap") && node.arguments[0]) {
      const item = callbackSummary(node.arguments[0], sourceFile);
      return {
        canBeEmpty: true,
        startsOpen: item.startsOpen,
        endsOpen: item.endsOpen,
        adjacent: item.adjacent || (item.endsOpen && item.startsOpen),
      };
    }
  }

  return OPAQUE;
}

function callbackSummary(callback, sourceFile) {
  const fn = unwrap(callback);
  if (!fn || !(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) return OPAQUE;
  if (!ts.isBlock(fn.body)) return renderedSummary(fn.body, sourceFile);

  const returns = [];
  function collect(node) {
    if (ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node)) returns.push(renderedSummary(node.expression, sourceFile));
    ts.forEachChild(node, collect);
  }
  ts.forEachChild(fn.body, collect);

  return returns.length === 0 ? EMPTY : returns.reduce(union);
}

export function designSystemCompositionViolations(source, projectPath = "source.tsx") {
  const sourceFile = ts.createSourceFile(
    projectPath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const violations = [];

  function line(node) {
    return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  }

  function visit(node) {
    if ((ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) && tagName(node, sourceFile) === "FilterBar") {
      const tabs = findAttribute(node, "tabs", sourceFile);
      const expression = tabs?.initializer && ts.isJsxExpression(tabs.initializer) ? unwrap(tabs.initializer.expression) : undefined;
      if (expression && tagName(expression, sourceFile) === "Segmented") {
        violations.push(`${projectPath}:${line(node)}: FilterBar.tabs requires Tabs; Segmented belongs in its actions slot`);
      }
    }

    if (ts.isJsxElement(node) && tagName(node, sourceFile) === "PageStack") {
      const summary = sequence(node.children.map((child) => renderedSummary(child, sourceFile)));
      if (summary.adjacent) {
        violations.push(`${projectPath}:${line(node)}: PageStack must not contain adjacent open Sections with their own vertical rhythm; use Panel → Section for compact groups`);
      }
    }

    if (ts.isJsxElement(node) && tagName(node, sourceFile) === "Panel") {
      for (const child of visualChildren(node)) {
        const childName = tagName(child, sourceFile);

        if (childName !== "Section") {
          violations.push(
            `${projectPath}:${line(child)}: Panel must compose direct visual content through Section; found ${childName}`,
          );
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}
