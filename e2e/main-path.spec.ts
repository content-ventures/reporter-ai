import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow, watchErrors } from "./support";

/**
 * Main path of R1 · Experiência (PLAN §8): paste a transcript → link the speakers → authorise →
 * generate the article → edit → send → approve → generate the carousel → send → approve → the
 * export package, with no console error on the way. Runs on a fresh workspace (new context).
 */

const TITLE = "Cooperativa de leite do Vale";

const TRANSCRIPT = [
  "Entrevistadora: Como a cooperativa começou?",
  "Paula Reis: Começou com doze famílias que vendiam leite para o mesmo laticínio e decidiram negociar juntas. No primeiro ano o preço do litro subiu 15%, e isso trouxe mais gente para a cooperativa.",
  "Entrevistadora: Quantas famílias são hoje?",
  "Paula Reis: Hoje são 140 famílias. Montamos um tanque de resfriamento coletivo e compramos um caminhão próprio, o que cortou o custo do frete pela metade.",
  "Entrevistadora: Qual é o próximo passo?",
  "Paula Reis: Produzir queijo. O leite sozinho paga pouco, e o queijo meia cura vende o dobro por litro processado. A queijaria começa a funcionar em março.",
].join("\n\n");

const EDIT = " A cooperativa recebe visitas às sextas.";

/** Opens a DS Select and picks an option from its own listbox. */
async function choose(page: Page, select: string, option: string | RegExp): Promise<void> {
  const combobox = page.getByRole("combobox", { name: select });
  await combobox.click();
  const listbox = page.locator(`[id="${await combobox.getAttribute("aria-controls")}"]`);
  await listbox.getByRole("option", { name: option }).click();
}

test("caminho principal: da transcrição ao pacote exportado", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });

  await test.step("colar a transcrição e ligar os falantes", async () => {
    await page.goto("/productions/new");
    await page.getByRole("textbox", { name: "Transcrição" }).fill(TRANSCRIPT);
    await expect(page.getByText("2 falantes", { exact: false }).first()).toBeVisible();

    await choose(page, "Entrevistadora", /Clara Souto/);
    await choose(page, "Paula Reis", "Nova pessoa");
    await page.getByRole("textbox", { name: "Cargo ou função de Paula Reis" }).fill("presidente");
    await page.getByRole("textbox", { name: "Organização de Paula Reis" }).fill("Cooperativa do Vale");
  });

  await test.step("autorizar e gerar o artigo", async () => {
    await page.getByRole("textbox", { name: "Título interno" }).fill(TITLE);
    await page.getByRole("radio", { name: "Curta" }).click();
    await page.getByRole("switch", { name: "Os falantes autorizaram o uso" }).click();
    await page.getByRole("button", { name: "Gerar artigo" }).click();
    await page.waitForURL(/\/productions\/[^/]+\/article$/);
  });

  const send = page.getByRole("button", { name: "Enviar para aprovação" }).first();

  await test.step("esperar a geração e editar o texto", async () => {
    await expect(send).toBeEnabled({ timeout: 150_000 });
    const editor = page.getByRole("textbox", { name: "Texto do artigo" });
    // The linked speaker is named in the text (never "diz P." or an unnamed label).
    await expect(editor).toContainText("Paula Reis");
    await editor.locator("p").last().click();
    await page.keyboard.press("End");
    await page.keyboard.type(EDIT);
    await expect(editor).toContainText(EDIT.trim());
  });

  await test.step("enviar e aprovar o artigo", async () => {
    await send.click();
    await page.waitForURL(/\/article\/review$/);
    await page.getByRole("button", { name: /^Aprovar versão \d+$/ }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: /^Aprovar versão \d+$/ }).click();
    await expect(page.getByText(/Versão \d+ aprovada/).first()).toBeVisible();
  });

  await test.step("gerar, enviar e aprovar o carrossel", async () => {
    await page.getByRole("button", { name: "Gerar carrossel" }).first().click();
    await page.waitForURL(/\/carousel$/);
    await page.getByRole("button", { name: /^Gerar textos/ }).first().click();
    const sendCarousel = page.getByRole("button", { name: "Enviar para aprovação" }).first();
    await expect(sendCarousel).toBeEnabled({ timeout: 90_000 });
    // The cover's title is a whole line of the article: never an attribution cut to ", diz".
    const coverTitle = page.getByRole("textbox", { name: "Título" }).first();
    await expect(coverTitle).not.toHaveValue(/(,|\s)diz$/);
    await expect(coverTitle).not.toHaveValue("");
    await sendCarousel.click();
    await page.waitForURL(/\/carousel\/review$/);
    await page.getByRole("button", { name: /^Aprovar versão \d+$/ }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: /^Aprovar versão \d+$/ }).click();
    await expect(page.getByText(/Versão \d+ aprovada/).first()).toBeVisible();
  });

  await test.step("exportar o pacote", async () => {
    await page.getByRole("button", { name: "Ir para entrega" }).first().click();
    await page.waitForURL(/\/delivery$/);
    for (const file of [/\.md$/, /\.html$/, /manifest[^ ]*\.json$/, /\.png$/]) {
      await expect(page.getByRole("link", { name: new RegExp(`^Baixar .*${file.source}`) }).first()).toBeVisible({ timeout: 30_000 });
    }
    // Every file of the package reaches the browser as a download, and the toast says how many.
    const files = await page.getByRole("link", { name: /^Baixar / }).count();
    const downloads: string[] = [];
    page.on("download", (download) => downloads.push(download.suggestedFilename()));
    await page.getByRole("button", { name: "Baixar pacote" }).first().click();
    await expect(page.getByText("Entrega concluída").first()).toBeVisible();
    await expect.poll(() => downloads.length, { timeout: 30_000 }).toBe(files);
    await expect(page.getByText(`${files} arquivos baixados`).first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  expect(errors, "erros no console").toEqual([]);
});
