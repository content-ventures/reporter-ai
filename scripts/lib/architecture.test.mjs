import assert from "node:assert/strict";
import test from "node:test";
import { architectureViolations, layerOf, moduleReferences, resolveSpecifier } from "./architecture.mjs";

function check(path, source) {
  return architectureViolations([{ path, source }]);
}

test("resolves layers and specifiers", () => {
  assert.equal(layerOf("src/domain/rules/can-derive.ts"), "domain");
  assert.equal(layerOf("scripts/check-architecture.mjs"), undefined);
  assert.deepEqual(resolveSpecifier("../ports/clock.ts", "src/domain/rules.ts"), { kind: "relative", path: "src/ports/clock.ts" });
  assert.deepEqual(resolveSpecifier("@/fixtures/demo", "src/ui/x.tsx"), { kind: "alias", path: "src/fixtures/demo" });
  assert.equal(resolveSpecifier("react", "src/ui/x.tsx").kind, "external");
});

test("collects imports, re-exports, type imports, dynamic imports and require", () => {
  const source = `
    import type { Version } from "./version.ts";
    export * from "./rules.ts";
    type Run = import("./run.ts").GenerationRun;
    const lazy = () => import("./lazy.ts");
    const legacy = require("./legacy.ts");
  `;

  assert.deepEqual(
    moduleReferences(source, "src/domain/index.ts").map((reference) => reference.specifier),
    ["./version.ts", "./rules.ts", "./run.ts", "./lazy.ts", "./legacy.ts"],
  );
});

test("accepts a pure domain and ports graph with .ts extensions", () => {
  assert.deepEqual(check("src/domain/rules.ts", `import type { Version } from "./version.ts";`), []);
  assert.deepEqual(check("src/ports/production.ts", `import type { Production } from "../domain/production.ts";`), []);
});

test("keeps domain and ports free of frameworks, aliases and outer layers", () => {
  assert.match(check("src/domain/a.ts", `import { useState } from "react";`)[0], /external module react/);
  assert.match(check("src/domain/a.ts", `import { Button } from "@content-ventures/design-system/v3";`)[0], /external module/);
  assert.match(check("src/ports/a.ts", `import type { X } from "@/domain/x";`)[0], /use relative .ts imports/);
  assert.match(check("src/domain/a.ts", `import { store } from "../state/store.ts";`)[0], /only modules inside src\/domain or src\/ports/);
  assert.match(check("src/domain/a.ts", `import type { Version } from "./version";`)[0], /must include the .ts extension/);
  assert.match(check("src/domain/a.tsx", "export const a = 1;")[0], /only framework-free .ts modules/);
});

test("lets domain tests and port contract suites use test tooling", () => {
  assert.deepEqual(check("src/domain/rules.test.ts", `
    import test from "node:test";
    import assert from "node:assert/strict";
    import { canDerive } from "./rules.ts";
    import { demo } from "../fixtures/demo.ts";
  `), []);
  assert.deepEqual(check("src/ports/production.contract.ts", `
    import test from "node:test";
    import assert from "node:assert/strict";
  `), []);
  assert.match(check("src/ports/production.ts", `import test from "node:test";`)[0], /external module node:test/);
});

test("allows simulation layers only from runtime and tests", () => {
  assert.deepEqual(check("src/runtime/create-runtime.ts", `
    import { createLocalAdapter } from "../adapters/local/index.ts";
    import { demo } from "../fixtures/demo.ts";
  `), []);
  assert.deepEqual(check("src/adapters/local/store.ts", `import { snapshot } from "./snapshot.ts";`), []);
  assert.deepEqual(check("src/adapters/local/adapter.test.ts", `import { demo } from "../../fixtures/demo.ts";`), []);
  assert.match(check("src/adapters/local/store.ts", `import { demo } from "../../fixtures/demo.ts";`)[0], /may be imported only by src\/runtime and tests/);
  assert.match(check("src/registries/flows.ts", `import { local } from "../adapters/local/index.ts";`)[0], /may be imported only by src\/runtime and tests/);
});

test("keeps UI layers away from adapters and fixtures", () => {
  for (const path of ["src/features/studio/page.tsx", "src/ui/piece-row.tsx", "src/components/x.tsx", "src/app/page.tsx", "src/state/hooks.ts"]) {
    assert.match(check(path, `import { demo } from "@/fixtures/demo";`)[0], /UI code must never import src\/fixtures/);
    assert.match(check(path, `import type { LocalAdapter } from "@/adapters/local";`)[0], /UI code must never import src\/adapters/);
  }
});

test("allows runtime only from state and layout-level providers", () => {
  assert.deepEqual(check("src/state/runtime-provider.tsx", `import { createRuntime } from "@/runtime/create-runtime";`), []);
  assert.deepEqual(check("src/app/layout.tsx", `import { createRuntime } from "@/runtime/create-runtime";`), []);
  assert.deepEqual(check("src/app/(workspace)/providers.tsx", `import { createRuntime } from "@/runtime/create-runtime";`), []);
  assert.deepEqual(check("src/runtime/create-runtime.test.ts", `import { createRuntime } from "./create-runtime.ts";`), []);
  assert.match(check("src/features/studio/page.tsx", `import { createRuntime } from "@/runtime/create-runtime";`)[0], /src\/runtime may be imported only/);
  assert.match(check("src/app/productions/page.tsx", `import { createRuntime } from "../../runtime/create-runtime";`)[0], /src\/runtime may be imported only/);
});

test("requires node-runnable imports in node-tested layers", () => {
  assert.match(check("src/adapters/local/store.ts", `import { x } from "./x";`)[0], /must include the .ts extension/);
  assert.match(check("src/runtime/create-runtime.ts", `import type { Ports } from "@/ports/index";`)[0], /cannot be resolved by node --test/);
  assert.deepEqual(check("src/state/hooks.ts", `import { useRuntime } from "./provider";`), []);
  assert.deepEqual(check("src/fixtures/index.ts", `import data from "./transcript.json" with { type: "json" };`), []);
});
