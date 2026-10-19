import { expect, test, type Locator } from "@playwright/test";
import { TEMPLATE_CATALOG } from "../src/fixtures/templates/catalog";
import { expectNoHorizontalOverflow, watchErrors } from "./support";

/**
 * The carousel model library (F1.5): the "Modelos" page — shelves by family, one format at a time, a
 * search, a model's page with the sample photo, made the default — and "Trocar modelo" in the carousel
 * studio, which draws this carousel in the candidate model, keeps the texts, redraws the slides at
 * the new model's proportion and can be undone from the toast. Each test opens a fresh context, so
 * the workspace starts from the fixtures.
 */

test.use({ viewport: { width: 1440, height: 900 } });

const FEED_MODELS = TEMPLATE_CATALOG.filter((entry) => entry.meta.format === "feed").length;

/** A slide image drawn at the proportion `ratio` (width / height), within a pixel. */
async function expectRatio(image: Locator, ratio: number): Promise<void> {
  await expect
    .poll(async () => {
      const box = await image.boundingBox();
      return box ? Math.abs(box.width / box.height - ratio) < 0.02 : false;
    })
    .toBe(true);
}

test("Modelos: prateleiras por família, busca, formato e a página do modelo", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/library/templates");
  const cards = page.getByRole("list", { name: /^Modelos/ }).getByRole("listitem");
  // One format at a time: Feed first, the models on shelves by family.
  await expect(cards).toHaveCount(FEED_MODELS);
  await expect(page.getByRole("list", { name: "Modelos de Notícia" })).toBeVisible();
  // The current Seafood library is editorially available without claiming Marketing approval.
  await expect(page.getByRole("main").getByText("Aprovado")).toHaveCount(0);
  // Static posts and Stories (9:16) are listed for a later release and cannot be chosen.
  await expect(page.getByRole("tab", { name: /Estáticos/ })).toBeDisabled();
  const formats = page.getByRole("radiogroup", { name: "Formato" });
  await expect(formats.getByRole("radio", { name: /Stories/ })).toBeDisabled();
  await formats.getByRole("radio", { name: /Quadrado/ }).click();
  await expect(cards).toHaveCount(3);
  await expect(page).toHaveURL(/[?&]format=square/);
  // The search ignores accents and case, inside the chosen format; elsewhere it offers that format.
  const search = page.getByRole("searchbox", { name: "Buscar modelo" });
  await search.fill("ASPAS");
  await expect(cards).toHaveCount(1);
  await search.fill("panorama");
  await page.getByRole("button", { name: /^Ver em Feed 4:5/ }).click();
  await expect(cards).toHaveCount(1);
  await search.fill("");
  await expect(cards).toHaveCount(FEED_MODELS);

  await test.step("a página do modelo: cada página desenhada, e o endereço leva até ela", async () => {
    await cards.getByRole("link", { name: "Seafood Panorama", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Seafood Panorama" })).toBeVisible();
    await expect(page).toHaveURL(/[?&]model=/);
    await expect(page.getByRole("img", { name: / no modelo Seafood Panorama$/ }).first()).toHaveAttribute("src", /^data:image\/png/);
    // "Usar como padrão": the next carousel starts from it, and the page says so.
    await page.getByRole("button", { name: "Usar como padrão" }).click();
    await expect(page.getByText("Seafood Panorama é o modelo padrão")).toBeVisible();
    await expect(page.getByRole("button", { name: "Usar como padrão" })).toBeHidden();

    // The same address opens the same model; the trail goes back to the shelves.
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Seafood Panorama" })).toBeVisible();
    await page.getByRole("link", { name: "Modelos", exact: true }).last().click();
    await expect(page).not.toHaveURL(/[?&]model=/);
    await expect(page.getByText("Padrão: Seafood Panorama")).toBeVisible();
  });

  await expectNoHorizontalOverflow(page);
  expect(errors, "erros no console").toEqual([]);
});

test("Trocar modelo no estúdio do carrossel: mantém os textos, muda a proporção e desfaz", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/productions/prod-lume/carousel");
  const status = page.getByLabel("Situação do carrossel");
  await expect(status).toContainText("Modelo Seafood Manchete");
  const cover = page.getByRole("img", { name: "Slide 1: Capa" });
  await expectRatio(cover, 4 / 5);
  const title = page.getByRole("textbox", { name: "Título" }).first();
  const before = await title.inputValue();

  await page.getByRole("button", { name: "Trocar modelo" }).first().click();
  const picker = page.getByRole("dialog", { name: "Trocar modelo" });
  const models = picker.getByRole("radiogroup", { name: "Modelos de carrossel" });
  // It opens on the carousel's own format and model.
  await expect(models.getByRole("radio")).toHaveCount(FEED_MODELS);
  await expect(models.getByRole("radio", { checked: true })).toHaveAccessibleName(/^Seafood Manchete/);
  await picker.getByRole("tab", { name: /Quadrado/ }).click();
  // "Ver modelo" draws this carousel in that model, with what changes, before anything is applied.
  await models.getByRole("button", { name: "Ver modelo Aspas" }).click();
  const detail = page.getByRole("dialog", { name: "Aspas" });
  await expect(detail.getByRole("img", { name: /^Slide 1 · Capa no modelo Aspas$/ })).toHaveAttribute("src", /^data:image\/png/);
  await expect(detail.getByText("Os textos cabem no modelo")).toBeVisible();
  await detail.getByRole("button", { name: "Usar este modelo" }).click();
  await expect(picker).toBeHidden();

  await expect(status).toContainText("Modelo Aspas");
  await expect(title).toHaveValue(before);
  await expectRatio(cover, 1);

  await page.getByRole("button", { name: "Desfazer" }).click();
  await expect(status).toContainText("Modelo Seafood Manchete");
  await expectRatio(cover, 4 / 5);
  await expect(title).toHaveValue(before);

  await expectNoHorizontalOverflow(page);
  expect(errors, "erros no console").toEqual([]);
});
