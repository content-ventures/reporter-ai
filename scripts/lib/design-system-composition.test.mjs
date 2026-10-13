import assert from "node:assert/strict";
import test from "node:test";
import { designSystemCompositionViolations } from "./design-system-composition.mjs";

function pageStackViolations(source) {
  return designSystemCompositionViolations(source).filter((violation) => violation.includes("PageStack"));
}

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

test("rejects adjacent open sections in a page stack", () => {
  const source = `
    <PageStack>
      <PageHeader title="Produção" />
      <Section title="Material" />
      <Section title="Peças" variant="open" />
    </PageStack>
  `;

  assert.equal(pageStackViolations(source).length, 1);
});

test("counts only one branch of a ternary", () => {
  const source = `
    <PageStack>
      <PageHeader title="Produção" />
      {ready ? <Section title="Artigo" /> : <Section title="Gerando" />}
    </PageStack>
  `;

  assert.deepEqual(pageStackViolations(source), []);
});

test("rejects a ternary that renders two adjacent open sections in one branch", () => {
  const source = `
    <PageStack>
      {ready ? <><Section title="Artigo" /><Section title="Carrossel" /></> : <Section title="Gerando" />}
    </PageStack>
  `;

  assert.equal(pageStackViolations(source).length, 1);
});

test("rejects an open section that may follow another through a condition", () => {
  const source = `
    <PageStack>
      <Section title="Material" />
      {hasDraft && <Section title="Rascunho" />}
    </PageStack>
  `;

  assert.equal(pageStackViolations(source).length, 1);
});

test("looks through fragments but not through other components", () => {
  const throughFragment = `
    <PageStack>
      <Fragment><Section title="Material" /></Fragment>
      <><Section title="Peças" /></>
    </PageStack>
  `;
  const separated = `
    <PageStack>
      <Section title="Material" />
      <Panel><Section title="Resumo" /><Section title="Checagens" /></Panel>
      <Section title="Peças" />
    </PageStack>
  `;
  const wrapped = `
    <PageStack>
      <Reveal open={open}><Section title="Material" /></Reveal>
      <Section title="Peças" />
    </PageStack>
  `;

  assert.equal(pageStackViolations(throughFragment).length, 1);
  assert.deepEqual(pageStackViolations(separated), []);
  assert.deepEqual(pageStackViolations(wrapped), []);
});

test("ignores panel and band sections and dynamic variants", () => {
  const source = `
    <PageStack>
      <Section title="Material" variant="panel" />
      <Section title="Peças" variant="band" />
      <Section title="Entrega" variant={variant} />
      <Section title="Histórico" variant="panel" />
    </PageStack>
  `;

  assert.deepEqual(pageStackViolations(source), []);
});

test("rejects lists that render one open section per item", () => {
  const source = `
    <PageStack>
      {pieces.map((piece) => <Section key={piece.id} title={piece.title} />)}
    </PageStack>
  `;
  const separatedItems = `
    <PageStack>
      {pieces.map((piece) => (
        <Fragment key={piece.id}>
          <Section title={piece.title} />
          <Divider />
        </Fragment>
      ))}
    </PageStack>
  `;

  assert.equal(pageStackViolations(source).length, 1);
  assert.deepEqual(pageStackViolations(separatedItems), []);
});

test("rejects Segmented as FilterBar tabs, including parenthesized expressions", () => {
  const source = `
    <FilterBar tabs={(<Segmented options={options} />)} />
  `;

  assert.match(designSystemCompositionViolations(source)[0], /FilterBar.tabs requires Tabs/);
});
