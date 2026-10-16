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
  /**
   * A production route: its TopBar trail "Produções › <título> › <etapa>" (no title on an error).
   * `title.href` is the stage the production is on, exactly where its index redirects this viewer.
   */
  trail?: { title?: { name: RegExp; href: string }; stage: string };
};

const heading = (name: string | RegExp) => (page: Page) => page.getByRole("heading", { name, level: 1 }).first();
const text = (value: string | RegExp) => (page: Page) => page.getByText(value).first();

/**
 * Navigation is by breadcrumbs only: no "Voltar para …" link, and the TopBar trail has "Produções"
 * (a link), the title (a link to the stage the production is on) and the stage as the current page.
 * On a phone the DS TopBar shows the first and the current level, so "Produções" stays a visible link.
 */
async function expectProductionTrail(page: Page, route: RouteCase, phone: boolean): Promise<void> {
  const trail = route.trail;
  if (!trail) return;
  const nav = page.getByRole("navigation", { name: "Trilha de navegação" });
  const productions = nav.getByRole("link", { name: "Produções", exact: true });
  await expect(page.getByRole("link", { name: /^Voltar para/ })).toHaveCount(0);
  await expect(productions).toBeVisible();
  await expect(productions).toHaveAttribute("href", "/productions");
  if (phone) return;
  await expect(nav.locator('[aria-current="page"]')).toHaveText(trail.stage);
  if (!trail.title) {
    await expect(nav.getByRole("link")).toHaveCount(1);
    return;
  }
  const title = nav.getByRole("link", { name: trail.title.name });
  await expect(title).toBeVisible();
  // The title leads where the production opens (the same stage the index redirects to), straight.
  await expect(title).toHaveAttribute("href", trail.title.href);
}

const ROUTES: readonly RouteCase[] = [
  { name: "Visão geral", path: "/", ready: text("Precisa de você"), live: true },
  { name: "Produções", path: "/productions", ready: heading("Produções") },
  { name: "Nova produção", path: "/productions/new", ready: (page) => page.getByRole("button", { name: "Usar exemplo" }).first() },
  { name: "Material", path: "/productions/prod-estudio-norte/source", ready: heading(/Estúdio Norte/), trail: { title: { name: /Estúdio Norte/, href: "/productions/prod-estudio-norte/article" }, stage: "Material" } },
  { name: "Material sem autorização", path: "/productions/prod-couro-nobre/source", ready: heading(/Couro Nobre/), trail: { title: { name: /Couro Nobre/, href: "/productions/prod-couro-nobre/source" }, stage: "Material" } },
  { name: "Estúdio em edição", path: "/productions/prod-estudio-norte/article", ready: (page) => page.getByRole("textbox", { name: "Texto do artigo" }), trail: { title: { name: /Estúdio Norte/, href: "/productions/prod-estudio-norte/article" }, stage: "Artigo" } },
  { name: "Estúdio gerando", path: "/productions/prod-atelie-sul/article", ready: (page) => page.getByRole("textbox", { name: "Texto do artigo" }), live: true, trail: { title: { name: /Ateliê Sul/, href: "/productions/prod-atelie-sul/article" }, stage: "Artigo" } },
  {
    name: "Estúdio com falha",
    path: "/productions/prod-horizonte/article",
    ready: heading(/Horizonte/),
    trail: { title: { name: /Horizonte/, href: "/productions/prod-horizonte/article" }, stage: "Artigo" },
    // A failed generation exposes a direct recovery action in the studio banner.
    desktop: async (page) => {
      const retry = page.getByRole("button", { name: "Tentar de novo", exact: true });
      await expect(retry).toBeVisible();
      await retry.click({ trial: true });
    },
  },
  { name: "Estúdio devolvido", path: "/productions/prod-casa-forma/article", ready: heading(/Casa Forma/), trail: { title: { name: /Casa Forma/, href: "/productions/prod-casa-forma/article" }, stage: "Artigo" } },
  { name: "Revisão do artigo", path: "/productions/prod-aurora/article/review", ready: (page) => page.getByRole("button", { name: "Aprovar artigo" }), trail: { title: { name: /Aurora/, href: "/productions/prod-aurora/article/review" }, stage: "Aprovação do artigo" } },
  { name: "Carrossel", path: "/productions/prod-lume/carousel", ready: heading(/Lume/), trail: { title: { name: /Lume/, href: "/productions/prod-lume/carousel" }, stage: "Carrossel" } },
  { name: "Revisão do carrossel", path: "/productions/prod-lume/carousel/review", ready: heading(/Lume/), trail: { title: { name: /Lume/, href: "/productions/prod-lume/carousel" }, stage: "Aprovação do carrossel" } },
  { name: "Carrossel desatualizado", path: "/productions/prod-patio-couro/carousel", ready: heading(/Pátio Couro/), trail: { title: { name: /Pátio Couro/, href: "/productions/prod-patio-couro/carousel" }, stage: "Carrossel" } },
  { name: "Entrega concluída", path: "/productions/prod-bella-passo/delivery", ready: heading(/Bella Passo/), trail: { title: { name: /Bella Passo/, href: "/productions/prod-bella-passo/delivery" }, stage: "Entrega" } },
  { name: "Entrega com carrossel desatualizado", path: "/productions/prod-patio-couro/delivery", ready: heading(/Pátio Couro/), trail: { title: { name: /Pátio Couro/, href: "/productions/prod-patio-couro/carousel" }, stage: "Entrega" } },
  { name: "Entrega · artigo final", path: "/productions/prod-bella-passo/delivery?view=article", ready: (page) => page.getByRole("list", { name: "Aprovação" }), trail: { title: { name: /Bella Passo/, href: "/productions/prod-bella-passo/delivery" }, stage: "Entrega" } },
  { name: "Produção abre a etapa atual", path: "/productions/prod-lume", landsOn: "/productions/prod-lume/carousel", ready: heading(/Lume/), trail: { title: { name: /Lume/, href: "/productions/prod-lume/carousel" }, stage: "Carrossel" } },
  { name: "Modelos", path: "/library/templates", ready: (page) => page.getByRole("button", { name: "Seafood Manchete", exact: true }).first() },
  { name: "Versões", path: "/whats-new", ready: heading("Versões") },
  { name: "Logs", path: "/admin/audit", ready: heading("Logs") },
  { name: "Endereço antigo de versões", path: "/versions", landsOn: "/whats-new", ready: heading("Versões") },
  { name: "Produção inexistente", path: "/productions/prod-inexistente/article", ready: heading("Produção não encontrada"), trail: { stage: "Artigo" } },
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
        await expectProductionTrail(page, route, viewport.width < 768);
      });
    }

    test("visão geral: retomar produção, consultar pendências, abrir kanban e manter o período", async ({ page }, testInfo) => {
      const errors = watchErrors(page);
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Início", level: 1, exact: true })).toBeVisible();
      const resume = page.getByRole("article", { name: /^Continuar:/ });
      const continueLink = resume.getByRole("link", { name: /^Continuar: Estúdio Norte/ });
      await expect(continueLink).toBeVisible();
      await expect(page.getByRole("region", { name: "Produções por etapa", exact: true })).toBeVisible();
      await expect(page.getByRole("list", { name: "Precisa de você", exact: true })).toContainText("Casa Forma");
      await expect(page.getByRole("list", { name: "Últimas movimentações", exact: true })).toBeVisible();
      await expectLoaded(page);
      await expectHeadingOutline(page);
      await expectNoHorizontalOverflow(page);
      const screenshot = testInfo.outputPath("overview.png");
      await page.screenshot({ path: screenshot, fullPage: true });
      await testInfo.attach("Início", { path: screenshot, contentType: "image/png" });

      await continueLink.click();
      await page.waitForURL("/productions/prod-estudio-norte/article");
      await expect(page.getByRole("textbox", { name: "Texto do artigo" })).toBeVisible();
      await page.goBack();
      await page.getByRole("link", { name: "Abrir kanban", exact: true }).click();
      await page.waitForURL("/productions");
      await expect(page.getByRole("heading", { name: "Produções", level: 1 })).toBeVisible();
      await page.goBack();

      await page.getByRole("radio", { name: "30 dias", exact: true }).click();
      await expect(page).toHaveURL((url) => url.searchParams.get("range") === "30d");
      await page.reload();
      await expect(page.getByRole("radio", { name: "30 dias", exact: true })).toBeChecked();
      await expect(page.getByText(/Últimos 30 dias:/)).toBeVisible();
      await expectNoHorizontalOverflow(page);
      expect(errors, "erros no console").toEqual([]);
    });

    test("escrever do zero: abrir editor, salvar texto e retomar sem transcrição", async ({ page }, testInfo) => {
      const errors = watchErrors(page);
      await page.goto("/");
      await page.getByRole("button", { name: "Escrever do zero", exact: true }).click();
      await page.waitForURL(/\/productions\/prod-.+\/article$/);
      const address = page.url();
      const editor = page.getByRole("textbox", { name: "Texto do artigo", exact: true });
      await expect(editor).toBeFocused();
      await expect(editor).toBeEmpty();
      await expect(page.getByRole("button", { name: "Gerar rascunho", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Gerar artigo", exact: true })).toHaveCount(0);
      await expectLoaded(page);
      await expectHeadingOutline(page);
      await expectNoHorizontalOverflow(page);
      const blank = testInfo.outputPath("blank-article.png");
      await page.screenshot({ path: blank, fullPage: true });
      await testInfo.attach("Escrever do zero", { path: blank, contentType: "image/png" });
      await page.getByRole("heading", { name: "Título do artigo", exact: true }).getByRole("button").click();
      const title = page.getByRole("textbox", { name: "Título do artigo", exact: true });
      await title.fill("Uma praça para o bairro");
      await title.press("Enter");
      const opening = "A praça ganhou um espaço de leitura criado pelos moradores do bairro.";
      await editor.fill(opening);
      // The body counter changes after the editor's debounce, before autosave settles.
      await expect(page.getByText(/0,1 de 2 laudas/)).toHaveCount(1);
      await expect(page.getByRole("status").filter({ hasText: /^Salvo$/ })).toBeVisible();
      await page.reload();
      await expect(page.getByRole("heading", { name: "Uma praça para o bairro", exact: true })).toBeVisible();
      await expect(editor).toContainText(opening);
      await expect(page.getByRole("button", { name: "Enviar para aprovação", exact: true }).first()).toBeVisible();
      await page.goto("/");
      const continued = page.getByRole("article", { name: /^Continuar:/ });
      await continued.getByRole("link", { name: "Continuar: Artigo sem título", exact: true }).click();
      await expect(page).toHaveURL(address);
      await expect(editor).toContainText(opening);
      await expectNoHorizontalOverflow(page);
      expect(errors, "erros no console").toEqual([]);
    });

    test("menu: demonstrações R2 abrem e etapas futuras permanecem indisponíveis", async ({ page }) => {
      const errors = watchErrors(page);
      await page.goto("/");
      await expect(text("Precisa de você")(page)).toBeVisible();
      const phone = viewport.width < 768;
      if (phone) await page.getByRole("button", { name: "Abrir menu" }).click();
      await page.getByRole("button", { name: "Em breve", exact: true }).click();
      await expect(page.getByRole("button", { name: /, Em breve$/ })).toHaveCount(9);
      await expect(page.getByRole("navigation", { name: "Menu principal" }).getByRole("link", { name: "Notícias — R2", exact: true })).toHaveAttribute("href", "/news");
      const planned = page.getByRole("button", { name: "Oportunidades, Em breve" });
      await expect(planned).toHaveAttribute("aria-disabled", "true");
      await expect(planned).toHaveAccessibleDescription(/Pautas Evergreen com dados de SEO\.\sChega\sna\sR3/);
      // Clique (ou toque), Enter e Espaço: nada abre, e na gaveta o menu continua aberto.
      if (phone) await planned.tap({ force: true });
      else await planned.click({ force: true });
      await planned.press("Enter");
      await planned.press(" ");
      await expect(page).toHaveURL((url) => url.pathname === "/");
      await expect(planned).toBeInViewport();
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
      await expect(page.getByRole("button", { name: "Escrever do zero", exact: true })).toHaveCount(0);
      await expect(page.getByRole("region", { name: "Produções recentes", exact: true }).getByRole("link", { name: /Couro Nobre/ })).toHaveCount(0);

      for (const [path, title] of [
        ["/admin/audit", "Logs restritos a administradores"],
        ["/productions/prod-couro-nobre/source", "Sem acesso a esta produção"],
      ] as const) {
        await page.goto(path);
        await expect(heading(title)(page)).toBeVisible();
        if (path.startsWith("/productions/")) {
          // A restricted production keeps the default trail "Produções › Material": its title never shows.
          // (A phone hides the levels above the current one, so the link is read hidden or not.)
          const nav = page.getByRole("navigation", { name: "Trilha de navegação" });
          await expect(nav.getByRole("link", { name: "Produções", exact: true, includeHidden: true })).toHaveAttribute("href", "/productions");
          await expect(nav.locator('[aria-current="page"]')).toHaveText("Material");
          await expect(nav.getByText(/Couro Nobre/)).toHaveCount(0);
        }
        await expectNoHorizontalOverflow(page);
      }
      expect(errors, "erros no console").toEqual([]);
    });
  });
}
