import { startScenario } from '../build/scenario.ts';
import { buildTranscriptSource } from '../build/source.ts';
import { PEOPLE } from '../people.ts';
import { atelieSulScripts } from '../scripts/atelie-sul.ts';
import { ATELIE_SUL_FILE_NAME, ATELIE_SUL_TRANSCRIPT } from '../sources/atelie-sul.ts';
import { ago, dateOf } from '../time.ts';
import type { Story, StoryContext } from './types.ts';

/**
 * Flagship state: generation RUNNING when the app opens (the "uau" of PLAN §3.1). Clara added
 * her interview minutes ago and started "Gerar artigo"; the log already covers reading the
 * material, selecting key lines and the outline, and the introduction step has just started.
 * The runtime continues the stream from the hand-written script (sections stream in order).
 */

/** How long before "now" the live run started; its log ends just before "now". */
export const LIVE_RUN_STARTED_SECONDS_AGO = 12;

export function atelieSulStory(ctx: StoryContext): Story {
  const createdAt = ago(ctx.now, { minutes: 6 });
  const source = buildTranscriptSource({
    id: 'src-atelie-sul',
    title: 'Entrevista Ateliê Sul: exportação, rastreabilidade e IA',
    origin: 'interview',
    text: ATELIE_SUL_TRANSCRIPT,
    fileName: ATELIE_SUL_FILE_NAME,
    speakers: { 'Clara Souto': PEOPLE.clara, 'Marina Lopes': PEOPLE.marina, 'Tiago Rezende': PEOPLE.tiago },
    authorized: true,
    recordedOn: dateOf(ago(ctx.now, { days: 3 })),
    createdAt,
    createdBy: PEOPLE.clara,
  });
  const script = atelieSulScripts(source);
  if (!script.draft) throw new Error('atelie-sul: missing draft');
  const builder = startScenario({
    key: 'atelie-sul',
    title: 'Entrevista Ateliê Sul',
    source,
    ownerId: PEOPLE.clara,
    createdAt,
    brief: {
      angle: 'Como uma fábrica média usa exportação, rastreabilidade e IA para crescer sem perder o ofício',
      sections: 3,
      length: 'medium',
      revision: 1,
    },
    plan: ['article', 'carousel'],
    templates: ctx.templates,
  });
  builder.streamArticle({
    script: script.draft,
    stopAt: 'intro',
    outcome: 'running',
    startedAt: ago(ctx.now, { seconds: LIVE_RUN_STARTED_SECONDS_AGO }),
    by: PEOPLE.clara,
  });
  return {
    scenario: builder.scenario,
    script,
    expect: {
      label: 'Geração em andamento',
      productionStatus: 'generating',
      pieces: { article: 'generating', carousel: 'locked' },
    },
  };
}
