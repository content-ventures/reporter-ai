/**
 * Jumps in the text (next AI block, next suggestion, a passage from the Checagem) land in the upper
 * third of the text pane: where the eye reads, with the line above still in view and room below
 * for the bar near the text. The DS `Prose edit` leaves room after the end of the text, so the last
 * blocks can rise there too. Reading only: nothing here creates DOM or touches styles.
 */

/** Share of the pane above the target once it is in view. */
const UPPER_THIRD = 0.22;

/** The nearest ancestor whose content overflows it: the text pane's scroll area. */
function scrollParent(element: Element): HTMLElement | null {
  for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
    if (node.scrollHeight > node.clientHeight + 1) return node;
  }
  return null;
}

/** Scrolls `element` so it starts in the upper third of its scroll area (instant with reduced motion). */
export function revealInUpperThird(element: Element): void {
  const container = scrollParent(element);
  if (!container) {
    element.scrollIntoView({ block: 'center' });
    return;
  }
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const offset = element.getBoundingClientRect().top - container.getBoundingClientRect().top;
  const top = Math.max(0, container.scrollTop + offset - container.clientHeight * UPPER_THIRD);
  container.scrollTo({ top, behavior: reduce ? 'auto' : 'smooth' });
}
