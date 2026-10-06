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

  function visit(node) {
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
