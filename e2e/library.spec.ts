import { expect, test, type Locator } from "@playwright/test";
import { expectNoHorizontalOverflow, watchErrors } from "./support";

/**
 * The carousel model library (F1.5): the "Modelos" page — one format at a time, a search, a model
 * opened in full with the sample photo and made the default — and "Trocar modelo" in the carousel
 * studio, which draws this carousel in the candidate model, keeps the texts, redraws the slides at
 * the new model's proportion and can be undone from the toast. Each test opens a fresh context, so
 * the workspace starts from the fixtures.
 */

test.use({ viewport: { width: 1440, height: 900 } });

/** A slide image drawn at the proportion `ratio` (width / height), within a pixel. */
async function expectRatio(image: Locator, ratio: number): Promise<void> {
  await expect
    .poll(async () => {
      const box = await image.boundingBox();
      return box ? Math.abs(box.width / box.height - ratio) < 0.02 : false;
    })
    .toBe(true);
}

test("Modelos: filtrar a biblioteca e abrir um modelo com todos os layouts", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/library/templates");
  const library = page.getByRole("list", { name: "Modelos de carrossel" });
  const cards = library.getByRole("listitem");
  // One format at a time: Feed first, every card at its proportion.
  await expect(cards).toHaveCount(7);
  // Only a model Marketing approved carries a badge.
  await expect(library.getByText("Aprovado")).toHaveCount(3);

  // Stories (9:16) is listed for a later release and cannot be chosen.
  await expect(page.getByRole("tab", { name: /Stories/ })).toBeDisabled();
  await page.getByRole("tab", { name: /Quadrado/ }).click();
  await expect(cards).toHaveCount(3);
  await expect(page).toHaveURL(/[?&]format=square/);
  // The search ignores accents and case, inside the chosen format; elsewhere it offers that format.
  const search = page.getByRole("searchbox", { name: "Buscar modelo" });
  await search.fill("ASPAS");
  await expect(cards).toHaveCount(1);
  await search.fill("numeros");
  await page.getByRole("button", { name: /^Ver em Feed 4:5/ }).click();
  await expect(cards).toHaveCount(1);
  await search.fill("");
  await expect(cards).toHaveCount(7);

  await test.step("abrir o modelo: cada layout desenhado, e o endereço leva até ele", async () => {
    await library.getByRole("button", { name: "Fotografia", exact: true }).click();
    const drawer = page.getByRole("dialog", { name: "Fotografia" });
    await expect(drawer).toBeVisible();
    await expect(page).toHaveURL(/[?&]model=/);
    const layouts = drawer.getByRole("img", { name: / no modelo Fotografia$/ });
    await expect(layouts).toHaveCount(7);
    await expect(drawer.getByRole("img", { name: "Capa no modelo Fotografia" })).toHaveAttribute("src", /^data:image\/png/);
    await expect(drawer.getByText("1080 × 1350 px")).toBeVisible();
    // "Usar como padrão": the next carousel starts from it, and the library says so.
    await drawer.getByRole("button", { name: "Usar como padrão" }).click();
    await expect(page.getByText("Fotografia é o modelo padrão")).toBeVisible();
    await expect(drawer.getByText("Modelo padrão dos próximos carrosséis")).toBeVisible();

    // The same address opens the same model.
    await page.reload();
    await expect(page.getByRole("dialog", { name: "Fotografia" })).toBeVisible();
    await page.getByRole("button", { name: "Fechar modelo" }).click();
    await expect(page.getByRole("dialog", { name: "Fotografia" })).toBeHidden();
    await expect(page).not.toHaveURL(/[?&]model=/);
  });

  await expectNoHorizontalOverflow(page);
  expect(errors, "erros no console").toEqual([]);
});

test("Trocar modelo no estúdio do carrossel: mantém os textos, muda a proporção e desfaz", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/productions/prod-lume/carousel");
  const status = page.getByLabel("Situação do carrossel");
  await expect(status).toContainText("Modelo Noturno");
  const cover = page.getByRole("img", { name: "Slide 1: Capa" });
  await expectRatio(cover, 4 / 5);
  const title = page.getByRole("textbox", { name: "Título" }).first();
  const before = await title.inputValue();

  await page.getByRole("button", { name: "Trocar modelo" }).first().click();
  const picker = page.getByRole("dialog", { name: "Trocar modelo" });
  const models = picker.getByRole("radiogroup", { name: "Modelos de carrossel" });
  // It opens on the carousel's own format and model.
  await expect(models.getByRole("radio")).toHaveCount(7);
  await expect(models.getByRole("radio", { checked: true })).toHaveAccessibleName(/^Noturno/);
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
  await expect(status).toContainText("Modelo Noturno");
  await expectRatio(cover, 4 / 5);
  await expect(title).toHaveValue(before);

  await expectNoHorizontalOverflow(page);
  expect(errors, "erros no console").toEqual([]);
});
