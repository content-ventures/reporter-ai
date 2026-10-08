import assert from "node:assert/strict";
import test from "node:test";
import { lowercaseMarkupViolations, sourceBanViolations } from "./source-bans.mjs";

function expectViolation(source, pattern, projectPath = "src/features/example.tsx") {
  const violations = sourceBanViolations(source, projectPath);
  assert.ok(violations.some((violation) => pattern.test(violation)), `expected ${pattern} in:\n${violations.join("\n")}`);
}

test("accepts composition through public components", () => {
  const source = `
    import { Button, Section } from "@content-ventures/design-system/v3";
    export function Actions({ className }: { className?: string }) {
      const label: Promise<string> = Promise.resolve("Aprovar");
      return <Section title="Ações" className={className}><Button onClick={() => label}>Aprovar</Button></Section>;
    }
  `;

  assert.deepEqual(sourceBanViolations(source, "src/features/actions.tsx"), []);
});

test("rejects resolved CSS values", () => {
  expectViolation("const color = getComputedStyle(element).color;", /getComputedStyle is not permitted/, "src/editor/toolbar.ts");
  expectViolation("const color = window.getComputedStyle(element).color;", /getComputedStyle is not permitted/, "src/editor/toolbar.ts");
});

test("rejects TipTap node views", () => {
  expectViolation(`import { ReactNodeViewRenderer } from "@tiptap/react";`, /node views are not permitted/);
  expectViolation("<NodeViewWrapper as=\"div\" />", /node views are not permitted/);
  expectViolation("Node.create({ addNodeView() { return renderer; } });", /node views are not permitted/, "src/editor/quote.ts");
});

test("rejects HTML injection", () => {
  expectViolation("<Prose dangerouslySetInnerHTML={{ __html: html }} />", /dangerouslySetInnerHTML is not permitted/);
  expectViolation("const props = { dangerouslySetInnerHTML: { __html: html } };", /dangerouslySetInnerHTML is not permitted/, "src/ui/props.ts");
  expectViolation("target.innerHTML = html;", /DOM creation is not permitted/, "src/editor/paste.ts");
  expectViolation("target.insertAdjacentHTML(\"beforeend\", html);", /DOM creation is not permitted/, "src/editor/paste.ts");
});

test("rejects style tags inside strings and templates", () => {
  expectViolation("const head = \"<style>body{}</style>\";", /strings containing <style/, "src/features/export.ts");
  expectViolation("const html = `<html><STYLE>p{}</STYLE>${body}</html>`;", /strings containing <style/, "src/features/export.ts");
  expectViolation("const html = `<main>${body}</main><style>p{}</style>`;", /strings containing <style/, "src/features/export.ts");
  assert.deepEqual(sourceBanViolations("assert.ok(!html.includes(\"<style\"));", "src/domain/export.test.ts"), []);
});

test("rejects imperative style mutation", () => {
  expectViolation("element.style.color = \"red\";", /imperative style mutation/, "src/editor/caret.ts");
  expectViolation("element.style = \"color: red\";", /imperative style mutation/, "src/editor/caret.ts");
  expectViolation("element.style[\"color\"] = token;", /imperative style mutation/, "src/editor/caret.ts");
  expectViolation("element.style.setProperty(\"--x\", \"1\");", /imperative style mutation/, "src/editor/caret.ts");
  expectViolation("Object.assign(element.style, { color: \"red\" });", /imperative style mutation/, "src/editor/caret.ts");
  expectViolation("element.setAttribute(\"style\", \"color: red\");", /imperative style mutation/, "src/editor/caret.ts");
  assert.deepEqual(sourceBanViolations("const style = theme.style; const tone = options.style;", "src/ui/tone.ts"), []);
});

test("rejects DOM creation", () => {
  expectViolation("const span = document.createElement(\"span\");", /DOM creation is not permitted/, "src/editor/decorations.ts");
  expectViolation("const span = view.dom.ownerDocument.createElement(\"span\");", /DOM creation is not permitted/, "src/editor/decorations.ts");
  expectViolation("const node = document.createTextNode(text);", /DOM creation is not permitted/, "src/editor/decorations.ts");
  expectViolation("return React.createElement(\"p\", null, text);", /local <p> markup through createElement/);
  assert.deepEqual(sourceBanViolations("return createElement(Section, { title });", "src/ui/factory.ts"), []);
});

test("rejects inline styles and literal classes in any form", () => {
  expectViolation("<Card style={cardStyle} />", /inline visual styles are not permitted/);
  expectViolation("<Card style={{ padding: 4 }} />", /inline visual styles are not permitted/);
  expectViolation("<Card className=\"card\" />", /literal CSS classes are not permitted/);
  expectViolation("<Card className={`card ${tone}`} />", /literal CSS classes are not permitted/);
  expectViolation("<Card className={active ? \"on\" : \"off\"} />", /literal CSS classes are not permitted/);
  expectViolation("const className = \"card\";", /literal CSS classes are not permitted/, "src/ui/card.ts");
  expectViolation("className = active ? \"on\" : \"off\";", /literal CSS classes are not permitted/, "src/ui/card.ts");
  expectViolation("element.className = tone;", /literal CSS classes are not permitted/, "src/editor/caret.ts");
  expectViolation("element.classList.add(\"active\");", /literal CSS classes are not permitted/, "src/editor/caret.ts");
});

test("ignores banned words inside comments", () => {
  const source = `
    // never call getComputedStyle( or document.createElement( here
    /* dangerouslySetInnerHTML and NodeViewWrapper are banned */
    export const ok = true;
  `;

  assert.deepEqual(sourceBanViolations(source, "src/domain/ok.ts"), []);
});

test("reports lowercase markup but not TypeScript generics", () => {
  const source = `
    const value = useState<string>("");
    const timer: ReturnType<typeof setTimeout> | undefined = undefined;
    export const Page = () => <div><Section title="Ok" /></div>;
  `;

  assert.deepEqual(lowercaseMarkupViolations(source, "src/app/page.tsx"), [
    "src/app/page.tsx: local <div> markup is not permitted; use a public Design System component",
  ]);
  assert.deepEqual(lowercaseMarkupViolations("<html><body /></html>", "src/app/layout.tsx", new Set(["html", "body"])), []);
});
