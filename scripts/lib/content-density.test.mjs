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
