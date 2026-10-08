import { foldRun } from '../domain/index.ts';
import type {
  ActivityEvent,
  ApprovalPoint,
  CarouselTemplate,
  FeedbackEntry,
  IsoDateTime,
  Member,
  Person,
  PersonId,
  ProductionId,
  ProductionRecord,
  RunEvent,
  RunFold,
  RunId,
  TemplateId,
  Workspace,
} from '../domain/index.ts';
import { deriveActivity } from './activity.ts';
import { seededHistory } from './history.ts';
import { SAMPLE_PHOTO } from './images.ts';
import type { FixtureImage } from './images.ts';
import type { FixtureHistory } from './history.ts';
import { DEFAULT_VIEWER_ID, FIXTURE_MEMBERS, FIXTURE_PEOPLE, fixtureWorkspace } from './people.ts';
import { createScriptBook } from './script-book.ts';
import type { ScriptBook, ScriptEntry } from './script-book.ts';
import { atelieSulStory } from './stories/atelie-sul.ts';
import { auroraStory } from './stories/aurora.ts';
import { bellaPassoStory } from './stories/bella-passo.ts';
import { casaFormaStory } from './stories/casa-forma.ts';
import { couroNobreStory } from './stories/couro-nobre.ts';
import { estudioNorteStory } from './stories/estudio-norte.ts';
import { horizonteStory } from './stories/horizonte.ts';
import { lumeStory } from './stories/lume.ts';
import { patioCouroStory } from './stories/patio-couro.ts';
import type { Story, StoryContext, StoryExpectation } from './stories/types.ts';
import type { TemplateLibraryData } from '../ports/render-template.ts';
import { CAROUSEL_TEMPLATE_DESCRIPTIONS, CAROUSEL_TEMPLATE_LIBRARY, CAROUSEL_TEMPLATE_RENDERS, CAROUSEL_TEMPLATES } from './templates/catalog.ts';
import type { TemplateRender } from './templates/provisional.ts';
import { ago, assertValidNow } from './time.ts';

/**
 * Fictional pt-BR material for the simulated runtime (imported ONLY by src/runtime and tests).
 * `createFixtures({ now })` returns a coherent workspace snapshot whose dates are relative to
 * the injected clock: one production per demo state, the hand-written outputs the simulated
 * generation streams, a 60-day summary history and the semantic activity feed.
 */

export type FixtureStory = { key: string; productionId: ProductionId; expect: StoryExpectation };

export type FixtureSet = {
  now: IsoDateTime;
  workspace: Workspace;
  people: Person[];
  members: Member[];
  /** Session user of the simulated runtime (João). */
  viewerId: PersonId;
  /** One normalised record per production, flagship first. */
  records: ProductionRecord[];
  /** Event logs of runs that are live or failed; finished runs need none. */
  runEvents: Record<RunId, RunEvent[]>;
  /** `foldRun` of each log: the `attach(runId)` snapshot (steps + completed blocks). */
  runFolds: Record<RunId, RunFold>;
  /** Ascending semantic activity feed. */
  activity: ActivityEvent[];
  feedback: FeedbackEntry[];
  history: FixtureHistory;
  templates: CarouselTemplate[];
  templateRenders: Record<TemplateId, TemplateRender>;
  /** pt-BR one-liners for the template ChoiceCard. */
  templateDescriptions: Record<TemplateId, string>;
  /** Library metadata (category, format, tags, status) and sample copy per template. */
  templateLibrary: Record<TemplateId, TemplateLibraryData>;
  scriptBook: ScriptBook;
  /** Catalogue of seeded states (for tests and the "Simulação" command group). */
  stories: FixtureStory[];
  /** Images the example's articles use: the asset store's seed (bytes served from `public/samples/`). */
  images: FixtureImage[];
  /** The library previews' sample photo ("Foto de exemplo"), drawn by the models that use an image. */
  samplePhoto: typeof SAMPLE_PHOTO;
};

export type FixtureOptions = {
  now: IsoDateTime;
  /** "Começar vazio": team and templates only, no productions or history. */
  empty?: boolean;
  historySeed?: number;
};

const STORIES: readonly ((ctx: StoryContext) => Story)[] = [
  atelieSulStory,
  estudioNorteStory,
  auroraStory,
  casaFormaStory,
  lumeStory,
  patioCouroStory,
  bellaPassoStory,
  horizonteStory,
  couroNobreStory,
];

export function createFixtures(options: FixtureOptions): FixtureSet {
  assertValidNow(options.now);
  const templates = CAROUSEL_TEMPLATES.map((template) => structuredClone(template));
  const base = {
    now: options.now,
    workspace: fixtureWorkspace(ago(options.now, { days: 90 })),
    people: FIXTURE_PEOPLE.map((person) => ({ ...person })),
    members: FIXTURE_MEMBERS.map((member) => ({ ...member, roles: [...member.roles] })),
    viewerId: DEFAULT_VIEWER_ID,
    templates,
    templateRenders: structuredClone(CAROUSEL_TEMPLATE_RENDERS),
    templateDescriptions: { ...CAROUSEL_TEMPLATE_DESCRIPTIONS },
    templateLibrary: structuredClone(CAROUSEL_TEMPLATE_LIBRARY) as Record<TemplateId, TemplateLibraryData>,
    samplePhoto: SAMPLE_PHOTO,
  };
  if (options.empty) {
    return {
      ...base,
      records: [],
      runEvents: {},
      runFolds: {},
      activity: [],
      feedback: [],
      history: { approvals: [], days: [] },
      scriptBook: createScriptBook([]),
      stories: [],
      images: [],
    };
  }

  const ctx: StoryContext = { now: options.now, templates };
  const stories = STORIES.map((story) => story(ctx));
  const records = stories.map((story) => story.scenario.record);
  const feedback = stories.flatMap((story) => story.scenario.feedback);
  // A draft script answers its story's brief: once the brief is edited, the generation writes from the material (A08).
  const scripts = stories
    .map((story): ScriptEntry | undefined => {
      const { script } = story;
      if (!script?.draft) return script;
      const { angle, sections, size } = story.scenario.record.production.brief;
      return { ...script, draft: { ...script.draft, brief: { ...(angle ? { angle } : {}), sections, size } } };
    })
    .filter((script): script is ScriptEntry => script !== undefined);
  const runEvents: Record<RunId, RunEvent[]> = Object.assign({}, ...stories.map((story) => story.scenario.runEvents));
  const runFolds: Record<RunId, RunFold> = {};
  for (const [runId, events] of Object.entries(runEvents)) {
    const fold = foldRun(events);
    if (fold) runFolds[runId] = fold;
  }
  return {
    ...base,
    records,
    runEvents,
    runFolds,
    activity: deriveActivity(records, feedback),
    feedback,
    history: seededHistory(options.now, options.historySeed === undefined ? {} : { seed: options.historySeed }),
    scriptBook: createScriptBook(scripts),
    stories: stories.map((story) => ({ key: story.scenario.key, productionId: story.scenario.record.production.id, expect: story.expect })),
    images: stories.flatMap((story) => story.images ?? []).map((image) => structuredClone(image)),
  };
}

/**
 * Seed in the shape the local store consumes (structural, so fixtures never import adapters):
 * the runtime passes `fixtureSeed(createFixtures({ now: clock.now() }))` as the store seed.
 */
export type FixtureSeed = {
  workspace: Workspace;
  people: Person[];
  members: Member[];
  sessionPersonId: PersonId;
  records: ProductionRecord[];
  activity: ActivityEvent[];
  feedback: FeedbackEntry[];
  history: ApprovalPoint[];
  runFolds: Record<RunId, RunFold>;
};

export function fixtureSeed(set: FixtureSet): FixtureSeed {
  return {
    workspace: set.workspace,
    people: set.people,
    members: set.members,
    sessionPersonId: set.viewerId,
    records: set.records,
    activity: set.activity,
    feedback: set.feedback,
    history: set.history.approvals,
    runFolds: set.runFolds,
  };
}

export { createScriptBook, scriptBody, blocksBefore } from './script-book.ts';
export type { ArticleDraftScript, RewriteVariant, ScriptBook, ScriptEntry, ScriptSection, SlideCopy } from './script-book.ts';
export { DEFAULT_VIEWER_ID, FIXTURE_MEMBERS, FIXTURE_PEOPLE, PEOPLE, WORKSPACE_ID, personName } from './people.ts';
export { HISTORY_DAYS, HISTORY_SEED, seededHistory } from './history.ts';
export type { DaySummary, FixtureHistory } from './history.ts';
export { deriveActivity } from './activity.ts';
export { SAMPLE_FILES, SAMPLE_PHOTO, fixtureImage, sampleSrc } from './images.ts';
export type { FixtureImage } from './images.ts';
export {
  DEFAULT_TEMPLATE_ID,
  NEUTRAL_DARK_TEMPLATE_ID,
  NEUTRAL_LIGHT_TEMPLATE_ID,
  PROVISIONAL_TEMPLATES,
  TEMPLATE_DESCRIPTIONS,
  TEMPLATE_RENDERS,
} from './templates/provisional.ts';
export type { LayoutRender, SlotStyle, TemplateRender } from './templates/provisional.ts';
export { CAROUSEL_TEMPLATE_DESCRIPTIONS, CAROUSEL_TEMPLATE_LIBRARY, CAROUSEL_TEMPLATE_RENDERS, CAROUSEL_TEMPLATES, TEMPLATE_CATALOG, templateEntry } from './templates/catalog.ts';
export type { TemplateEntry } from './templates/catalog.ts';
export type { StoryExpectation } from './stories/types.ts';
export { LIVE_RUN_STARTED_SECONDS_AGO } from './stories/atelie-sul.ts';
export { STREAM_TICK_MS } from './build/runs.ts';
