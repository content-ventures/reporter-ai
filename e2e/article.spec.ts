import { expect, test, type Locator } from "@playwright/test";
import { expectLoaded, expectNoHorizontalOverflow, watchErrors } from "./support";

/**
 * The article around its text: an image the generation suggested (an image slot) filled by an
 * upload in the studio, and another by a file dropped on it; the review reading the article in one
 * centred column; and the final article of a delivered production reading with its images, a
 * vertical one in the middle of the column. Each test opens a fresh context, so the workspace starts
 * from the fixtures.
 */

test.use({ viewport: { width: 1440, height: 900 } });

/** A valid 1 × 1 PNG (the upload only needs a real image file). */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

/** Horizontal centre of an element, in page pixels (NaN while it is not laid out: the poll retries). */
async function centreOf(locator: Locator): Promise<number> {
  const box = await locator.boundingBox().catch(() => null);
  return box ? box.x + box.width / 2 : Number.NaN;
}

async function expectCentredIn(column: Locator, area: Locator, tolerance = 40): Promise<void> {
  await expect.poll(async () => Math.abs((await centreOf(column)) - (await centreOf(area))), { message: "coluna do artigo no centro da área" }).toBeLessThanOrEqual(tolerance);
}

test("Estúdio: preencher uma imagem sugerida enviando um arquivo", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/productions/prod-estudio-norte/article");
  const editor = page.getByRole("textbox", { name: "Texto do artigo" });
  await expect(editor).toBeVisible();
  const slots = editor.locator("figure[data-slot]");
  const total = await slots.count();
  expect(total, "imagens sugeridas no rascunho").toBeGreaterThan(0);
  // The status line counts the figure suggestions still open (the cover's stays under "Imagem de destaque", optional).
  const pending = page.getByLabel("Situação do texto").getByRole("button", { name: / a preencher$/ });
  const open = Number.parseInt(await pending.innerText(), 10);
  expect(open).toBeGreaterThanOrEqual(total);

  await slots.first().click();
  const bar = page.getByRole("toolbar", { name: "Imagem sugerida" });
  await bar.getByRole("button", { name: "Enviar imagem" }).click();

  const picker = page.getByRole("dialog", { name: "Inserir imagem" });
  await expect(picker).toBeVisible();
  // The picker says what the image should show and starts the alt text from the suggestion.
  await expect(picker.getByText(/^Sugestão: /)).toBeVisible();
  const alt = picker.getByRole("textbox", { name: "Texto alternativo" });
  await expect(alt).not.toHaveValue("");
  const altText = await alt.inputValue();
  await picker.locator('input[type="file"]').setInputFiles({ name: "foto.png", mimeType: "image/png", buffer: PNG });
  await picker.getByRole("button", { name: "Inserir imagem" }).click();
  await expect(picker).toBeHidden();

  await expect(slots).toHaveCount(total - 1);
  await expect(editor.getByRole("img", { name: altText })).toBeVisible();
  if (open > 1) await expect(pending).toHaveText(`${open - 1} ${open - 1 === 1 ? "imagem" : "imagens"} a preencher`);

  if (total > 1) {
    // A file dropped on the next suggestion answers it: the picker opens on that file, and the slot
    // becomes the figure (never a second figure beside it).
    const figures = editor.locator("figure");
    const before = await figures.count();
    await slots.first().scrollIntoViewIfNeeded();
    const box = await slots.first().boundingBox();
    expect(box).not.toBeNull();
    await page.evaluate(
      ({ x, y, bytes }) => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0))], "foto.png", { type: "image/png" }));
        const target = document.elementFromPoint(x, y);
        for (const type of ["dragenter", "dragover", "drop"]) target?.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: x, clientY: y }));
      },
      { x: (box?.x ?? 0) + (box?.width ?? 0) / 2, y: (box?.y ?? 0) + (box?.height ?? 0) / 2, bytes: PNG.toString("base64") },
    );
    await expect(picker).toBeVisible();
    await expect(picker.getByText(/^Sugestão: /)).toBeVisible();
    await picker.getByRole("button", { name: "Inserir imagem" }).click();
    await expect(picker).toBeHidden();
    await expect(slots).toHaveCount(total - 2);
    await expect(figures).toHaveCount(before);
  }

  await expectNoHorizontalOverflow(page);
  expect(errors, "erros no console").toEqual([]);
});

test("Revisão: o artigo lê numa coluna centrada, com o painel aberto ou recolhido", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/productions/prod-aurora/article/review");
  await expect(page.getByRole("button", { name: /Aprovar versão/ }).first()).toBeVisible();
  await expectLoaded(page);
  const column = page.locator('[data-part="reading-column"]').first();
  await expect(column).toBeVisible();

  // Open pane: the column sits in the middle of the text's region, left of the pane.
  await expectCentredIn(column, page.getByRole("region", { name: "Texto", exact: true }));

  const collapse = page.getByRole("button", { name: "Recolher Detalhes" });
  await collapse.click();
  // The header toggle and the pane's rail both offer it back.
  const show = page.getByRole("button", { name: "Mostrar Detalhes" }).first();
  await expect(show).toHaveAttribute("aria-expanded", "false");
  // Collapsed: the column sits in the middle of the main area.
  await expectCentredIn(column, page.getByRole("main"));

  // The choice is kept in this browser.
  await page.reload();
  await expect(show).toBeVisible();
  await expectLoaded(page);
  await expectCentredIn(column, page.getByRole("main"));

  await expectNoHorizontalOverflow(page);
  expect(errors, "erros no console").toEqual([]);
});

test("Entrega: o artigo final lê com as imagens, a vertical no centro da coluna", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/productions/prod-bella-passo/delivery?view=article");
  const article = page.getByRole("article");
  await expect(article).toBeVisible();
  await expectLoaded(page);
  // The cover and both figures the editor filled, each a loaded picture with its alt text.
  for (const name of ["Par de tênis infantis da Bella Passo visto de cima", "Tênis infantil ao lado das palmilhas grossa e fina", "Caixa do kit de demonstração com as palmilhas grossa e fina lado a lado"]) {
    const image = article.getByRole("img", { name });
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth), { message: name }).toBeGreaterThan(0);
  }
  // No suggestion left open: nothing was left out of the article.
  await expect(page.getByText(/sugerida.* de fora/)).toHaveCount(0);
  // The vertical image sits in the middle of the text column, its caption under it.
  const kit = article.locator("figure").filter({ has: page.getByRole("img", { name: /^Caixa do kit/ }) });
  await expectCentredIn(kit, page.locator('[data-part="reading-column"]').first(), 2);

  await expectNoHorizontalOverflow(page);
  expect(errors, "erros no console").toEqual([]);
});
