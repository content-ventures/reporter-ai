import { expect, test, type Page } from "@playwright/test";
import {
  VIEWPORTS,
  expectHeadingOutline,
  expectLoaded,
  expectNoHorizontalOverflow,
  watchErrors,
} from "./support";

/**
 * Release smoke for the connected product. It runs against a fresh Reporter PostgreSQL instance,
 * exercises the real same-origin API and never calls a paid AI provider or persists a production.
 * The broader fixture regression suite is preserved and runs in a separate disposable build.
 */

async function expectShell(page: Page, heading: string | RegExp): Promise<void> {
  await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
  await expectLoaded(page);
  await expectHeadingOutline(page);
  await expectNoHorizontalOverflow(page);
}

for (const viewport of VIEWPORTS) {
  test.describe(`runtime conectado em ${viewport.name}`, () => {
    test.use(
      viewport.width < 768
        ? { viewport: { width: viewport.width, height: viewport.height }, hasTouch: true, isMobile: true }
        : { viewport: { width: viewport.width, height: viewport.height } },
    );

    test("abre o workspace real e as superfícies editoriais", async ({ page }) => {
      const errors = watchErrors(page);

      for (const [path, heading] of [
        ["/", "Qual história vamos entregar hoje?"],
        ["/productions", "Produções"],
        ["/quotes", "Citações"],
        ["/images", "Imagens"],
        ["/config", "Engenharia de prompts"],
      ] as const) {
        await page.goto(path);
        await expectShell(page, heading);
      }

      expect(errors, "erros no console").toEqual([]);
    });

    test("analisa o exemplo sem criar produção nem chamar IA paga", async ({ page }) => {
      const errors = watchErrors(page);
      await page.goto("/productions/new");
      await expectShell(page, "Nova produção");

      await page.getByRole("button", { name: "Usar exemplo" }).click();
      await expect(page.getByRole("textbox", { name: "Transcrição" })).not.toBeEmpty();
      await expect(page.getByText(/falantes?/).first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Continuar" })).toBeVisible();
      await expectNoHorizontalOverflow(page);

      expect(errors, "erros no console").toEqual([]);
    });

    test("abre a biblioteca atual e a prévia de um modelo Seafood", async ({ page }) => {
      const errors = watchErrors(page);
      await page.goto("/library/templates?format=feed&q=seafood");
      await expectShell(page, "Modelos");

      const library = page.getByRole("list", { name: "Modelos de carrossel" });
      await expect(library.getByRole("listitem")).not.toHaveCount(0);
      await library.getByRole("button", { name: "Seafood Entrevista", exact: true }).click();
      const preview = page.getByRole("dialog", { name: /Seafood Entrevista/ });
      await expect(preview).toBeVisible();
      await expect(preview.getByRole("img").first()).toBeVisible();
      await expectNoHorizontalOverflow(page);

      expect(errors, "erros no console").toEqual([]);
    });
  });
}
