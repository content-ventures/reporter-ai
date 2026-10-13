import assert from "node:assert/strict";
import test from "node:test";
import { fileViolations } from "../check-design-system.mjs";

test("accepts public Design System imports in product code", () => {
  const source = `
    import { Section } from "@content-ventures/design-system/v3";
    import { Sparkles } from "@content-ventures/design-system/v3/icons";
    export const Title = () => <Section title="Peças" action={<Sparkles />} />;
  `;

  assert.deepEqual(fileViolations("src/features/pieces.tsx", source), []);
});

test("rejects private Design System paths and external visual libraries", () => {
  const violations = fileViolations("src/ui/chip.tsx", `
    import { Chip } from "@content-ventures/design-system/src/components/ds-v3/badge";
    import { Check } from "lucide-react";
    const Lazy = () => import("@radix-ui/react-popover");
  `);

  assert.equal(violations.length, 3);
  assert.match(violations[0], /public Design System V3 API/);
  assert.match(violations[1], /external visual library lucide-react/);
  assert.match(violations[2], /external visual library @radix-ui\/react-popover/);
});

test("rejects local stylesheets that define colors or tokens", () => {
  assert.match(fileViolations("src/app/x.module.css", ".a {}")[0], /CSS Modules are not permitted/);
  assert.match(fileViolations("src/app/globals.css", ":root { --brand: #fff; }")[0], /local colors or design tokens/);
  assert.deepEqual(fileViolations("src/app/globals.css", "@import \"x.css\";"), []);
});

test("applies markup and composition rules only to JSX files", () => {
  assert.match(fileViolations("src/ui/row.tsx", "export const Row = () => <span />;")[0], /local <span> markup/);
  assert.deepEqual(fileViolations("src/domain/generic.ts", "const items: Array<string> = [];"), []);
  assert.deepEqual(fileViolations("src/app/layout.tsx", "export default () => <html><body /></html>;"), []);
});
