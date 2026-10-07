import ts from "typescript";

function tagName(element, sourceFile) {
  if (ts.isJsxElement(element)) {
    return element.openingElement.tagName.getText(sourceFile);
  }

  if (ts.isJsxSelfClosingElement(element)) {
    return element.tagName.getText(sourceFile);
  }

  return undefined;
}

function visualChildren(element) {
  return element.children.filter(
    (child) => ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child),
  );
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

  function openSectionsInStack(stack) {
    const sections = [];
    function inspect(node) {
      if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
        if (tagName(node, sourceFile) !== "Section") return;
        const attributes = ts.isJsxElement(node) ? node.openingElement.attributes : node.attributes;
        const variant = attributes.properties.find((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(sourceFile) === "variant");
        if (!variant || (variant.initializer && ts.isStringLiteral(variant.initializer) && variant.initializer.text === "open")) sections.push(node);
        return;
      }
      ts.forEachChild(node, inspect);
    }
    stack.children.forEach(inspect);
    return sections;
  }

  function visit(node) {
    if ((ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) && tagName(node, sourceFile) === "FilterBar") {
      const attributes = ts.isJsxElement(node) ? node.openingElement.attributes : node.attributes;
      const tabs = attributes.properties.find((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(sourceFile) === "tabs");
      const expression = tabs?.initializer && ts.isJsxExpression(tabs.initializer) ? tabs.initializer.expression : undefined;
      if (expression && tagName(expression, sourceFile) === "Segmented") {
        violations.push(`${projectPath}: FilterBar.tabs requires Tabs; Segmented belongs in its actions slot`);
      }
    }
    if (ts.isJsxElement(node) && tagName(node, sourceFile) === "PageStack" && openSectionsInStack(node).length > 1) {
      violations.push(`${projectPath}: PageStack must not stack open Sections with their own vertical rhythm; use Panel → Section for compact groups`);
    }
    if (ts.isJsxElement(node) && tagName(node, sourceFile) === "Panel") {
      for (const child of visualChildren(node)) {
        const childName = tagName(child, sourceFile);

        if (childName !== "Section") {
          violations.push(
            `${projectPath}: Panel must compose direct visual content through Section; found ${childName}`,
          );
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return violations;
}
