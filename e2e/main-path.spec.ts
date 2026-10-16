import { expect, test, type Locator, type Page } from "@playwright/test";
import { chooseCard, expectNoHorizontalOverflow, watchErrors } from "./support";

/**
 * Main path of R1 · Experiência (PLAN §8): paste a transcript → link the speakers → authorise →
 * generate the article → edit → send → approve → choose a carousel model → generate the carousel →
 * send → approve → the export package, with no console error on the way. Every send and approval
 * lands on the board, where whoever acts next opens their step from the card. Runs on a fresh
 * workspace (new context).
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

async function actAs(page: Page, name: string): Promise<void> {
  await page.keyboard.press("ControlOrMeta+k");
  await page.keyboard.type(`Entrar como ${name}`);
  await page.getByRole("option", { name: new RegExp(`Entrar como ${name}`) }).click();
  await expect(page.getByText(`Você entrou como ${name}`).first()).toBeVisible();
}

/**
 * A stage move ends on the board: the card is marked in its new column, the move is announced with
 * who acts now ("…: Aprovação · com Pedro"), and the address drops `destaque`.
 */
async function expectMoved(page: Page, column: string, announcement: string): Promise<Locator> {
  await page.waitForURL((url) => url.pathname === "/productions");
  const card = page.getByRole("region", { name: column, exact: true }).getByRole("listitem", { name: TITLE });
  await expect(card).toHaveAttribute("data-arrived", "true");
  await expect(page.getByRole("status").filter({ hasText: `${TITLE}: ${announcement}` })).toHaveCount(1);
  await expect(page).toHaveURL((url) => url.pathname === "/productions" && !url.searchParams.has("destaque"));
  return card;
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

  await test.step("autorizar, revisar a pauta e gerar o artigo", async () => {
    await page.getByRole("checkbox", { name: "Os falantes autorizaram o uso" }).click();
    await page.getByRole("button", { name: "Continuar" }).click();
    await page.getByRole("textbox", { name: "Título interno" }).fill(TITLE);
    // The R1 policy intentionally disables the short preset: its 2,000-character ceiling
    // cannot satisfy the mandatory 2,500-character minimum. Keep the selected standard size.
    await expect(page.getByRole("radio", { name: /^Padrão/ })).toBeChecked();
    await page.getByRole("button", { name: "Gerar artigo", exact: true }).click();
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
    const sendDialog = page.getByRole("dialog", { name: "Enviar para aprovação" });
    await sendDialog.getByRole("button", { name: "Marcar como revisado" }).click();
    // João is admin and would approve his own send; this path is the two-person one.
    await choose(page, "Quem aprova", /Pedro/);
    const submit = sendDialog.getByRole("button", { name: /^Enviar para / });
    await expect(submit).toBeEnabled();
    await submit.click();
    const sent = await expectMoved(page, "Aprovação", "Aprovação · com Pedro");
    await actAs(page, "Pedro");
    await sent.getByRole("link", { name: "Revisar", exact: true }).click();
    await page.waitForURL(/\/article\/review$/);
    // Approving takes one confirmation, with no note.
    await page.getByRole("button", { name: "Aprovar artigo" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Aprovar o artigo?" });
    await expect(dialog).toContainText("Depois, João cria o carrossel.");
    await dialog.getByRole("button", { name: "Aprovar artigo", exact: true }).click();
    await expect(dialog).toBeHidden();
    const approved = await expectMoved(page, "Carrossel", "Carrossel · com João");
    await actAs(page, "João");
    await approved.getByRole("link", { name: "Criar carrossel", exact: true }).click();
    await page.waitForURL(/\/carousel$/);
  });

  await test.step("escolher o modelo, gerar, enviar e aprovar o carrossel", async () => {
    // A square model from the library (its format tab first): the preview takes its size before anything is generated.
    await page.getByRole("tab", { name: /Quadrado/ }).click();
    await chooseCard(page.getByRole("radiogroup", { name: "Modelo do carrossel" }), /^Aspas/);
    await expect(page.getByRole("img", { name: "Prévia da capa no modelo Aspas" })).toBeVisible();
    await expect(page.getByText("Capa · 1080 × 1080 px")).toBeVisible();
    await page.getByRole("button", { name: /^Gerar textos/ }).first().click();
    const sendCarousel = page.getByRole("button", { name: "Enviar para aprovação" }).first();
    await expect(sendCarousel).toBeEnabled({ timeout: 90_000 });
    await expect(page.getByLabel("Situação do carrossel")).toContainText("Modelo Aspas");
    // The cover's title is a whole line of the article: never an attribution cut to ", diz".
    const coverTitle = page.getByRole("textbox", { name: "Título" }).first();
    await expect(coverTitle).not.toHaveValue(/(,|\s)diz$/);
    await expect(coverTitle).not.toHaveValue("");
    await sendCarousel.click();
    // The carousel goes to the creative reviewer.
    const sent = await expectMoved(page, "Carrossel", "Carrossel · com Juliana");
    await actAs(page, "Juliana Prates");
    await sent.getByRole("link", { name: "Revisar", exact: true }).click();
    await page.waitForURL(/\/carousel\/review$/);
    await page.getByRole("button", { name: "Aprovar carrossel" }).first().click();
    const approveCarousel = page.getByRole("dialog", { name: "Aprovar o carrossel?" });
    await expect(approveCarousel).toContainText("Depois, João baixa o pacote.");
    await approveCarousel.getByRole("button", { name: "Aprovar carrossel", exact: true }).click();
    await expect(approveCarousel).toBeHidden();
    const approved = await expectMoved(page, "Entrega", "Entrega · com João");
    await actAs(page, "João");
    await approved.getByRole("link", { name: "Baixar pacote", exact: true }).click();
    await page.waitForURL(/\/delivery$/);
  });

  await test.step("exportar o pacote", async () => {
    for (const file of [/\.md$/, /\.html$/, /manifest[^ ]*\.json$/, /\.png$/]) {
      await expect(page.getByRole("link", { name: new RegExp(`^Baixar .*${file.source}`) }).first()).toBeVisible({ timeout: 30_000 });
    }
    // Every file of the package reaches the browser as a download, and the toast says how many.
    const files = await page.getByRole("link", { name: /^Baixar / }).count();
    const downloads: string[] = [];
    page.on("download", (download) => downloads.push(download.suggestedFilename()));
    await page.getByRole("button", { name: "Baixar pacote" }).first().click();
    await expect(page.getByText(`Pacote baixado · ${files} arquivos`).first()).toBeVisible();
    await expect(page.getByText("Produção concluída.").first()).toBeVisible();
    await expect.poll(() => downloads.length, { timeout: 30_000 }).toBe(files);
    await expectNoHorizontalOverflow(page);
  });

  expect(errors, "erros no console").toEqual([]);
});
