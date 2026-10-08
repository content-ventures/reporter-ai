import { expect, type ConsoleMessage, type Locator, type Page } from "@playwright/test";

/** The two widths every screen must hold (PLAN §8: desktop and a 390 px phone). */
export const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
] as const;

/** A console message as the allow-list reads it: its text, then " @ " and the URL it is about. */
function describeMessage(message: ConsoleMessage): string {
  return `${message.text()} @ ${message.location().url}`;
}

/**
 * Console errors and uncaught exceptions of a page, from now on. `allow` drops the messages a
 * scenario expects, matched against "text @ url" (the 404 document of the not-found route, and
 * never a missing font or chunk).
 */
export function watchErrors(page: Page, allow: readonly RegExp[] = []): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = describeMessage(message);
    if (!allow.some((pattern) => pattern.test(text))) errors.push(text);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

/** No sideways scroll on the page itself (inner panes may scroll on their own). */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "rolagem lateral da página").toBeLessThanOrEqual(0);
}

/**
 * The screen's data loaded: no DS skeleton block (`[data-skeleton]`, the DS's documented loading
 * hook) and no region still busy (`aria-busy`, set by `SkeletonRegion` and loading controls).
 */
export async function expectLoaded(page: Page): Promise<void> {
  await expect(page.locator("[data-skeleton]")).toHaveCount(0);
  await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0);
}

/** One h1, and no heading level skipped on the way down (visible and screen-reader headings). */
export async function expectHeadingOutline(page: Page): Promise<void> {
  const levels = await page.evaluate(() =>
    [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")]
      .filter((heading) => !heading.closest('[aria-hidden="true"], [inert], [hidden]') && heading.getClientRects().length > 0)
      .map((heading) => ({ level: Number(heading.tagName.slice(1)), text: (heading.textContent ?? "").trim().slice(0, 40) })),
  );
  expect(levels.filter((heading) => heading.level === 1).map((heading) => heading.text), "uma h1 por página").toHaveLength(1);
  const skips: string[] = [];
  levels.forEach((heading, index) => {
    const previous = levels[index - 1];
    if (previous && heading.level > previous.level + 1) skips.push(`h${previous.level} → h${heading.level} "${heading.text}"`);
  });
  expect(skips, "níveis de título sem pular").toEqual([]);
}

/**
 * Picks a DS ChoiceCard the way a person does: a click on the card (its whole label chooses; the
 * thumbnail paints over the native radio, so the radio itself is not the click target).
 */
export async function chooseCard(group: Locator, name: string | RegExp): Promise<void> {
  const radio = group.getByRole("radio", { name });
  await group.locator("label", { has: group.page().getByRole("radio", { name }) }).click();
  await expect(radio).toBeChecked();
}
