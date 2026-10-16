import assert from "node:assert/strict";
import test from "node:test";
import { contentDensityViolations } from "../check-content-density.mjs";

test("accepts a page header with one necessary supporting layer", () => {
  const source = `
    export function Page() {
      return <PageHeader title="Versions" description="Release history and version policy." />;
    }
  `;

  assert.deepEqual(contentDensityViolations(source), []);
});

test("rejects stacked page-header explanations", () => {
  const source = `
    export function Page() {
      return (
        <PageHeader
          eyebrow="Release governance"
          title="Versions"
          description="Release history and version policy."
          meta={["R0", "SemVer", "Manual release"]}
        />
      );
    }
  `;

  const violations = contentDensityViolations(source);
  assert.equal(violations.length, 2);
  assert.match(violations[0], /keep at most one supporting text layer/);
  assert.match(violations[1], /more than 2 items/);
});

test("rejects verbose metric hints", () => {
  const source = `
    const metrics = [{
      label: "Current release",
      value: "R0",
      hint: "This unnecessarily long supporting sentence repeats the value and adds detail without helping the reader make a decision or understand an exception."
    }];
  `;

  assert.match(contentDensityViolations(source)[0], /metric hint exceeds/);
});

test("rejects a page-header back link: navigation is the TopBar trail", () => {
  const source = `
    export function Page() {
      return <PageHeader variant="frame" back={{ label: "Produções", href: "/productions" }} title="Lume" />;
    }
  `;

  const violations = contentDensityViolations(source);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /PageHeader back is not used; the TopBar trail is the only page navigation/);
});

test("rejects props spread on a page header: they could carry a back link past the policy", () => {
  const source = `
    const props = { back: { label: "Produções", href: "/productions" } };
    export function Page() {
      return <PageHeader {...props} title="Lume" />;
    }
  `;

  const violations = contentDensityViolations(source);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /PageHeader props are written out \(no spread\)/);
});

test("reads an aliased or namespaced page header too", () => {
  const source = `
    import * as DS from "@content-ventures/design-system/v3";
    import { PageHeader as Header } from "@content-ventures/design-system/v3";
    export function Page() {
      return <>
        <Header back={{ label: "Produções", href: "/productions" }} title="Lume" />
        <DS.PageHeader back={{ label: "Produções", href: "/productions" }} title="Lume" />
      </>;
    }
  `;

  const violations = contentDensityViolations(source);
  assert.equal(violations.length, 2);
  for (const violation of violations) assert.match(violation, /PageHeader back is not used/);
});
