import type { CarouselBody, CarouselTemplate, Slide, SlideLayout, SlotRole, SlotSpec } from './carousel.ts';
import type { SlideId } from './ids.ts';

/**
 * Switching a carousel to another template (studio "Modelo") or a slide to another layout keeps
 * the person's texts: slots are mapped by id, then by role; a text whose role the new layout lacks
 * joins the closest slot (a figure joins the text it introduces, list items become lines of
 * text); what still has no place is reported with its text, never dropped silently. Pure: the
 * render service adds the line fit of the result (`RenderService.switchTemplate`).
 */

/** Where a layout the new template lacks goes: the closest layout it has, in order. */
export const LAYOUT_FALLBACKS: Readonly<Record<string, readonly string[]>> = {
  context: ['point'],
  point: ['context'],
  data: ['point', 'context'],
  list: ['point', 'context'],
  quote: ['point', 'context'],
  closing: ['point', 'context'],
};

const ROLES: ReadonlySet<string> = new Set<SlotRole>(['kicker', 'title', 'body', 'quote', 'attribution', 'cta', 'stat', 'list']);

/** The role a text joins when the new layout has no slot of its own role. */
const JOINS: Partial<Record<SlotRole, readonly SlotRole[]>> = {
  stat: ['body'],
  quote: ['body'],
  list: ['body'],
  attribution: ['body'],
  body: ['list', 'quote'],
};

export type TemplateSwitchIssueKind = 'layout' | 'merged' | 'dropped' | 'over_budget' | 'missing' | 'overflow' | 'count';

export type TemplateSwitchIssue = {
  slideId: SlideId;
  /** 1-based slide position, as the messages say it. */
  position: number;
  kind: TemplateSwitchIssueKind;
  /** Slot of the new layout; for `dropped`, the slot the text came from. */
  slotId?: string;
  /** pt-BR, one line: "Slide 3: Número foi para Texto." */
  message: string;
  /** The text that found no place (`dropped`), so the screen can offer it back. */
  text?: string;
};

export type TemplateSwitch = { body: CarouselBody; issues: TemplateSwitchIssue[] };

type Entry = { id: string; role: SlotRole | undefined; label: string; text: string };

function entriesOf(slide: Slide, source: SlideLayout | undefined): Entry[] {
  if (source) {
    return source.slots
      .map((spec) => ({ id: spec.id, role: spec.role, label: spec.label, text: slide.slots[spec.id]?.trim() ?? '' }))
      .filter((entry) => entry.text);
  }
  // Unknown source layout: a slot id that names a role is read as that role.
  return Object.entries(slide.slots)
    .map(([id, text]) => ({ id, role: ROLES.has(id) ? (id as SlotRole) : undefined, label: id, text: text.trim() }))
    .filter((entry) => entry.text);
}

function startsLower(text: string): boolean {
  const first = text.trim().charAt(0);
  return first !== '' && first === first.toLocaleLowerCase('pt-BR') && first !== first.toLocaleUpperCase('pt-BR');
}

function unquoted(text: string): string {
  return text.trim().replace(/^[“"«]+|[”"»]+$/g, '').trim();
}

/** Text of `entry` joined into a slot that already holds `current` (of the slot's own role). */
function joined(entry: Entry, current: string, into: SlotRole): string {
  const base = current.trim();
  if (into === 'list') {
    const items = entry.role === 'body' ? entry.text.split(/(?<=[.!?…])\s+/) : [entry.text];
    return [base, ...items.map((item) => item.trim())].filter(Boolean).join('\n');
  }
  if (into === 'quote') return base ? `${base} ${entry.text}` : unquoted(entry.text);
  switch (entry.role) {
    case 'stat':
      if (!base) return entry.text;
      if (base.includes(entry.text)) return base;
      return startsLower(base) ? `${entry.text} ${base}` : `${entry.text} — ${base}`;
    case 'quote':
      return [`“${unquoted(entry.text)}”`, base].filter(Boolean).join('\n');
    case 'attribution':
      return [base, `— ${entry.text.replace(/^[—–-]\s*/, '')}`].filter(Boolean).join('\n');
    default:
      return [base, entry.text].filter(Boolean).join('\n');
  }
}

/** The layout of `to` a slide of layout `layoutId` (in `from`) goes to. */
export function targetLayout(to: CarouselTemplate, from: CarouselTemplate | undefined, layoutId: string): SlideLayout | undefined {
  const find = (id: string) => to.layouts.find((layout) => layout.id === id);
  const isCover = layoutId === (from?.coverLayoutId ?? 'cover');
  if (isCover) return find(to.coverLayoutId) ?? find(layoutId);
  const direct = find(layoutId);
  if (direct) return direct;
  for (const candidate of LAYOUT_FALLBACKS[layoutId] ?? []) {
    const found = find(candidate);
    if (found) return found;
  }
  return to.layouts.find((layout) => layout.id !== to.coverLayoutId) ?? to.layouts[0];
}

/**
 * One slide in another layout: slots by id and role, then joined, then reported. `position` is
 * the slide's 1-based place (for the messages).
 */
export function remapSlide(slide: Slide, source: SlideLayout | undefined, target: SlideLayout, position: number): { slide: Slide; issues: TemplateSwitchIssue[] } {
  const issues: TemplateSwitchIssue[] = [];
  const issue = (kind: TemplateSwitchIssueKind, message: string, extra: Partial<TemplateSwitchIssue> = {}) =>
    issues.push({ slideId: slide.id, position, kind, message: `Slide ${position}: ${message}`, ...extra });
  if (source && source.id !== target.id) issue('layout', `${source.label} passou a ${target.label}.`);

  const slots: Record<string, string> = {};
  const taken = new Set<string>();
  const place = (spec: SlotSpec, text: string) => {
    slots[spec.id] = text;
    taken.add(spec.id);
  };
  const entries = entriesOf(slide, source);
  const left: Entry[] = [];
  for (const entry of entries) {
    const same = target.slots.find((spec) => spec.id === entry.id && !taken.has(spec.id) && (!entry.role || spec.role === entry.role));
    const byRole = entry.role ? target.slots.find((spec) => spec.role === entry.role && !taken.has(spec.id)) : undefined;
    const spec = same ?? byRole;
    if (spec) place(spec, entry.text);
    else left.push(entry);
  }
  // Joins in reading order of the result: the figure before its text, list items and credits after.
  const order: SlotRole[] = ['stat', 'quote', 'list', 'body', 'attribution'];
  left.sort((a, b) => order.indexOf(a.role as SlotRole) - order.indexOf(b.role as SlotRole));
  for (const entry of left) {
    const into = (entry.role ? (JOINS[entry.role] ?? []) : [])
      .map((role) => target.slots.find((spec) => spec.role === role))
      .find((spec): spec is SlotSpec => Boolean(spec));
    if (into) {
      slots[into.id] = joined(entry, slots[into.id] ?? '', into.role);
      taken.add(into.id);
      issue('merged', `${entry.label} foi para ${into.label}.`, { slotId: into.id });
    } else {
      issue('dropped', `${entry.label} ficou de fora.`, { slotId: entry.id, text: entry.text });
    }
  }
  for (const spec of target.slots) {
    const value = slots[spec.id]?.trim() ?? '';
    if (!value && spec.required) issue('missing', `falta ${spec.label.toLocaleLowerCase('pt-BR')}.`, { slotId: spec.id });
    else if (value.length > spec.maxChars) issue('over_budget', `${spec.label} passa de ${spec.maxChars} caracteres.`, { slotId: spec.id });
  }
  return { slide: { ...slide, layout: target.id, slots }, issues };
}

/**
 * The carousel in template `to`, keeping its slides, ids, order and origin. Same template: no
 * change. Issues name what moved, what joined another slot, what was left out (with its text)
 * and what passes the new character budgets; the renderer adds the line fit.
 */
export function switchTemplate(body: CarouselBody, from: CarouselTemplate | undefined, to: CarouselTemplate): TemplateSwitch {
  if (body.templateId === to.id) return { body, issues: [] };
  const issues: TemplateSwitchIssue[] = [];
  const slides = body.slides.map((slide, index) => {
    const source = from?.layouts.find((layout) => layout.id === slide.layout);
    const target = targetLayout(to, from, slide.layout);
    if (!target) return slide;
    const remapped = remapSlide(slide, source, target, index + 1);
    issues.push(...remapped.issues);
    return remapped.slide;
  });
  const extra = slides[to.maxSlides];
  if (extra) {
    issues.push({
      slideId: extra.id,
      position: to.maxSlides + 1,
      kind: 'count',
      message: `O modelo ${to.name} aceita até ${to.maxSlides} slides.`,
    });
  }
  return { body: { ...body, templateId: to.id, slides }, issues };
}

/** A slide in another layout of the same template (the slide keeps its texts, as above). */
export function changeSlideLayout(slide: Slide, template: CarouselTemplate, layoutId: string, position: number): { slide: Slide; issues: TemplateSwitchIssue[] } | undefined {
  const target = template.layouts.find((layout) => layout.id === layoutId);
  if (!target) return undefined;
  const source = template.layouts.find((layout) => layout.id === slide.layout);
  if (source?.id === target.id) return { slide, issues: [] };
  return remapSlide(slide, source, target, position);
}
