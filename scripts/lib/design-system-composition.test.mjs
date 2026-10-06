import assert from "node:assert/strict";
import test from "node:test";
import { designSystemCompositionViolations } from "./design-system-composition.mjs";

test("accepts the Design System panel and section composition", () => {
  const source = `
    export function History() {
      return (
        <Panel padding="lg">
          <Section title="History">
            <Timeline items={items} label="Versions" />
          </Section>
        </Panel>
      );
    }
  `;

  assert.deepEqual(designSystemCompositionViolations(source), []);
});

test("rejects visual content without the structural section wrapper", () => {
  const source = `
    export function History() {
      return (
        <Panel padding="lg">
          <Timeline items={items} label="Versions" />
        </Panel>
      );
    }
  `;

  assert.match(
    designSystemCompositionViolations(source)[0],
    /Panel must compose direct visual content through Section/,
  );
});
