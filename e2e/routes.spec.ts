import { expect, test, type Locator, type Page } from "@playwright/test";
import { VIEWPORTS, expectHeadingOutline, expectLoaded, expectNoHorizontalOverflow, watchErrors } from "./support";

/**
 * Route sweep: every R1 screen and the fixture states of §3.9, at 1440 and 390, with no console
 * error and no sideways scroll. Each test opens a fresh browser context, so the workspace starts
 * from the fixtures (the same as `?reset=1`).
 */

type RouteCase = {
  name: string;
  path: string;
  /** What the loaded screen shows (beyond the skeletons being gone). */
  ready: (page: Page) => Locator;
  /** Where the route lands after its redirect. */
  landsOn?: string;
  /** Console messages this route is expected to print. */
  allow?: readonly RegExp[];
  /** Screens with a live run keep a skeleton for the block being written. */
  live?: boolean;
  /** Extra check on the loaded screen (desktop only: on a phone the panes are tabs). */
  desktop?: (page: Page) => Promise<void>;
};

const heading = (name: string | RegExp) => (page: Page) => page.getByRole("heading", { name, level: 1 }).first();
const text = (value: string | RegExp) => (page: Page) => page.getByText(value).first();

const ROUTES: readonly RouteCase[] = [
  { name: "Visão geral", path: "/", ready: text("Precisa de você"), live: true },
  { name: "Produções", path: "/productions", ready: heading("Produções") },
  { name: "Nova produção", path: "/productions/new", ready: (page) => page.getByRole("button", { name: "Usar exemplo" }).first() },
  { name: "Material", path: "/productions/prod-estudio-norte/source", ready: heading(/Estúdio Norte/) },
  { name: "Material sem autorização", path: "/productions/prod-couro-nobre/source", ready: heading(/Couro Nobre/) },
  { name: "Estúdio em edição", path: "/productions/prod-estudio-norte/article", ready: (page) => page.getByRole("textbox", { name: "Texto do artigo" }) },
  { name: "Estúdio gerando", path: "/productions/prod-atelie-sul/article", ready: (page) => page.getByRole("textbox", { name: "Texto do artigo" }), live: true },
  {
    name: "Estúdio com falha",
    path: "/productions/prod-horizonte/article",
    ready: heading(/Horizonte/),
    // The copilot opens at its end: "Tentar de novo" is visible and nothing covers it ("Ir para o fim").
    desktop: async (page) => {
      const retry = page.getByRole("button", { name: "Tentar de novo a partir desta etapa" });
      await expect(retry).toBeVisible();
      // Let the conversation's own scroll events and resize observers settle (two frames).
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      await expect(page.getByRole("button", { name: "Ir para o fim" })).toHaveCount(0);
      await retry.click({ trial: true });
    },
  },
  { name: "Estúdio devolvido", path: "/productions/prod-casa-forma/article", ready: heading(/Casa Forma/) },
  { name: "Revisão do artigo", path: "/productions/prod-aurora/article/review", ready: (page) => page.getByRole("button", { name: /Aprovar versão/ }).first() },
  { name: "Carrossel", path: "/productions/prod-lume/carousel", ready: heading(/Lume/) },
  { name: "Revisão do carrossel", path: "/productions/prod-lume/carousel/review", ready: heading(/Lume/) },
  { name: "Carrossel desatualizado", path: "/productions/prod-patio-couro/carousel", ready: heading(/Pátio Couro/) },
  { name: "Entrega concluída", path: "/productions/prod-bella-passo/delivery", ready: heading(/Bella Passo/) },
  { name: "Entrega com carrossel desatualizado", path: "/productions/prod-patio-couro/delivery", ready: heading(/Pátio Couro/) },
  { name: "Entrega · artigo final", path: "/productions/prod-bella-passo/delivery?view=article", ready: (page) => page.getByRole("list", { name: "Aprovação" }) },
  { name: "Produção abre a etapa atual", path: "/productions/prod-lume", landsOn: "/productions/prod-lume/carousel", ready: heading(/Lume/) },
  { name: "Modelos", path: "/library/templates", ready: (page) => page.getByRole("button", { name: "Editorial", exact: true }).first() },
  { name: "Novidades", path: "/whats-new", ready: heading("Novidades") },
  { name: "Logs", path: "/admin/audit", ready: heading("Logs") },
  { name: "Versões redireciona para Novidades", path: "/versions", landsOn: "/whats-new", ready: heading("Novidades") },
  { name: "Produção inexistente", path: "/productions/prod-inexistente/article", ready: heading("Produção não encontrada") },
  {
    name: "Página inexistente",
    path: "/rota-inexistente",
    ready: heading("Página não encontrada"),
    // Only the 404 of the document itself (a missing font or chunk is still an error).
    allow: [/Failed to load resource: the server responded with a status of 404 .* @ https?:\/\/[^/]+\/rota-inexistente$/],
  },
];

test.describe.configure({ mode: "parallel" });

for (const viewport of VIEWPORTS) {
  test.describe(`rotas em ${viewport.name}`, () => {
    // The phone is a touch device (the 390 layout must hold without hover and with a touch UA).
    test.use(viewport.width < 768 ? { viewport: { width: viewport.width, height: viewport.height }, hasTouch: true, isMobile: true } : { viewport: { width: viewport.width, height: viewport.height } });

    for (const route of ROUTES) {
      test(route.name, async ({ page }) => {
        const errors = watchErrors(page, route.allow);
        await page.goto(route.path);
        await expect(route.ready(page)).toBeVisible();
        if (route.landsOn) await expect(page).toHaveURL((url) => url.pathname === route.landsOn);
        if (!route.live) await expectLoaded(page);
        if (route.desktop && viewport.width >= 1024) await route.desktop(page);
        await expectHeadingOutline(page);
        await expectNoHorizontalOverflow(page);
        expect(errors, "erros no console").toEqual([]);
      });
    }

    test("visão geral: continuar no estúdio original, filtrar produções, consultar equipe e manter o período", async ({ page }, testInfo) => {
      const errors = watchErrors(page);
      await page.goto("/");
      const featured = page.getByRole("article", { name: /^Continuar: Estúdio Norte/ });
      await expect(featured.getByRole("progressbar", { name: /^Etapas de Estúdio Norte/ })).toBeVisible();
      await expect(page.getByRole("list", { name: "Últimas movimentações", exact: true })).toBeVisible();
      await expectLoaded(page);
      const screenshot = testInfo.outputPath("overview.png");
      await page.screenshot({ path: screenshot, fullPage: true });
      await testInfo.attach("Início", { path: screenshot, contentType: "image/png" });

      await page.getByRole("tab", { name: /^Material/ }).click();
      const material = page.getByRole("tabpanel", { name: /^Material/ });
      await expect(material.getByRole("article", { name: /Couro Nobre/ })).toBeVisible();
      await expect(material.getByRole("article")).toHaveCount(1);
      await material.getByRole("link", { name: /^Autorizar:/ }).click();
      await page.waitForURL("/productions/prod-couro-nobre/source");
      await expect(page.getByRole("heading", { name: /Couro Nobre/, level: 1 })).toBeVisible();
      await page.goBack();
      const approvalTab = page.getByRole("tab", { name: /^Aprovação/ });
      await approvalTab.click();
      await expect(page.getByRole("tabpanel", { name: /^Aprovação/ })).toContainText("Aurora");
      await approvalTab.press("ArrowRight");
      await expect(page.getByRole("tab", { name: /^Carrossel/ })).toBeFocused();
      await expect(page.getByRole("tabpanel", { name: /^Carrossel/ })).toContainText("Lume");
      await expectNoHorizontalOverflow(page);
      await page.getByRole("tab", { name: /^Todas/ }).click();

      await featured.getByRole("link", { name: /^Continuar:/ }).click();
      await page.waitForURL("/productions/prod-estudio-norte/article");
      await expect(page.getByRole("textbox", { name: "Texto do artigo" })).toBeVisible();

      await page.goBack();
      await page.getByRole("link", { name: "Ver prioridades" }).click();
      await expect(page.getByRole("heading", { name: "Precisa de você", exact: true })).toBeInViewport();
      await page.getByRole("radio", { name: "Equipe", exact: true }).click();
      await expect(page.getByRole("list", { name: "Equipe", exact: true })).toContainText("Bella Passo");
      await page.getByRole("radio", { name: "Para mim", exact: true }).click();
      await expect(page.getByRole("list", { name: "Precisa de você", exact: true })).toContainText("Casa Forma");

      await page.getByRole("radio", { name: "30 dias", exact: true }).click();
      await expect(page).toHaveURL((url) => url.searchParams.get("range") === "30d");
      await page.reload();
      await expect(page.getByRole("radio", { name: "30 dias", exact: true })).toBeChecked();
      await expect(page.getByText(/Últimos 30 dias:/)).toBeVisible();
      await expectNoHorizontalOverflow(page);
      expect(errors, "erros no console").toEqual([]);
    });

    test("menu: o mapa R1–R7 mostra o que ainda não abre como “Em breve”", async ({ page }) => {
      const errors = watchErrors(page);
      await page.goto("/");
      await expect(text("Precisa de você")(page)).toBeVisible();
      const phone = viewport.width < 768;
      if (phone) await page.getByRole("button", { name: "Abrir menu" }).click();
      await expect(page.getByRole("button", { name: /, Em breve$/ })).toHaveCount(17);
      const news = page.getByRole("button", { name: "Notícias, Em breve" });
      await expect(news).toHaveAttribute("aria-disabled", "true");
      await expect(news).toHaveAccessibleDescription(/Fila de notícias com triagem por IA\.\sChega\sna\sR2\s·\sHard\sNews/);
      // Clique (ou toque), Enter e Espaço: nada abre, e na gaveta o menu continua aberto.
      if (phone) await news.tap({ force: true });
      else await news.click({ force: true });
      await news.press("Enter");
      await news.press(" ");
      await expect(page).toHaveURL((url) => url.pathname === "/");
      await expect(news).toBeInViewport();
      expect(errors, "erros no console").toEqual([]);
    });

    test("acesso restrito para quem não é admin", async ({ page }) => {
      const errors = watchErrors(page);
      await page.goto("/");
      await expect(text("Precisa de você")(page)).toBeVisible();
      // ⌘K › Simulação › "Entrar como Pedro" (aprovador, sem o papel de admin).
      await page.keyboard.press("ControlOrMeta+k");
      await page.keyboard.type("Entrar como Pedro");
      await page.getByRole("option", { name: /Entrar como Pedro/ }).click();
      await expect(text("Você entrou como Pedro")(page)).toBeVisible();

      for (const [path, title] of [
        ["/admin/audit", "Logs restritos a administradores"],
        ["/productions/prod-couro-nobre/source", "Sem acesso a esta produção"],
      ] as const) {
        await page.goto(path);
        await expect(heading(title)(page)).toBeVisible();
        await expectNoHorizontalOverflow(page);
      }
      expect(errors, "erros no console").toEqual([]);
    });
  });
}
