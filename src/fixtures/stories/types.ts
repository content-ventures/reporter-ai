import type { CarouselTemplate, IsoDateTime, PieceKind, PieceStatus, ProductionStatus } from '../../domain/index.ts';
import type { Scenario } from '../build/scenario.ts';
import type { FixtureImage } from '../images.ts';
import type { ScriptEntry } from '../script-book.ts';

/** Inputs every fixture story receives: the injected clock instant and the creative templates. */
export type StoryContext = { now: IsoDateTime; templates: readonly CarouselTemplate[] };

/** What the story is meant to demonstrate; the integrity test checks it against the domain rules. */
export type StoryExpectation = {
  /** pt-BR label of the seeded state ("Ajustes solicitados com nota"). */
  label: string;
  productionStatus: ProductionStatus;
  pieces: Partial<Record<PieceKind, PieceStatus>>;
  /** Quote check of the article working draft; deliberate "Falta" cases are declared here. */
  draftQuotes?: { verified: number; total: number };
};

export type Story = {
  scenario: Scenario;
  /** Hand-written outputs for this story's source (absent: the extractive path applies). */
  script?: ScriptEntry;
  /** Images the story's articles use (served from `public/samples/`). */
  images?: FixtureImage[];
  expect: StoryExpectation;
};
