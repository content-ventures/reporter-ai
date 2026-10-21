import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PIPELINE_STEP_KEYS, defaultPipelineDefinition, pipelineRevision, type PipelineDefinition } from './pipeline.ts';
import { defaultFunnelPrompt } from './format-prompts.ts';
import { KNOWN_DEFAULT_PROMPTS, PRESET_PROMPT_KEYS, currentDefaultPrompt, promptDefaultState, promptHash, upgradePreset } from './pipeline-preset.ts';

/** Production's active revision 1: the defaults of v0.4.0, never saved again on the Prompts page. */
const revisionOne = (): PipelineDefinition => JSON.parse(readFileSync(new URL('../../tests/fixtures/pipeline-revision-1.json', import.meta.url), 'utf8'));
const MODEL = 'openai/gpt-6-astra';

/** Defaults that releases shipped (v0.1.0–v0.14.0): a stored copy of any of them is untouched. */
const SHIPPED: Record<string, string[]> = {
  system: ['669ee81a08ea5915', '2534ab151043d1c5'], material: ['f2b461021e0b5c11'], facts: ['6558b17d9d797766'],
  outline: ['e5203e280fee131e'], quotes: ['80d9eaf28f5ffad7'], intro: ['2369abf2e11a5efd', 'b221e8c51a52d9a3', '65999fd2cbcf956e'],
  section: ['dee060967f886971', '65d0d5d891a6f1fc', 'a1c067a739fcb2ee'], article: ['daaa232019f19657'], assist: ['38867eb4b4bba83d'],
  images: ['6068d8ef38d2cf73'], carousel: ['9cedc2c5c9e818f6', '6172c117be9e19af'],
  'funnel:stand:outline': ['ea8f2d1adadeed6f', '1421e239c15ffc51', '2bc03d67f6ddb5a2'],
  'funnel:stand:intro': ['c11ca073650066cb', 'b0f6a6b6eeb52f69', '3cf22b4b80f421f5', 'c7d7b912bad7cb88', '701284b367713b5b', '3bdae37ab603cbfb'],
  'funnel:stand:section': ['87d1c11b9480ec22', '365106dc822e3fcf', '3bfa1b6c22e5f49f', 'f4c08defc3e8fbc3', '17aec6140f0115da', 'e7699dd88d1dda8e'],
  'funnel:panel:outline': ['d828f87a79d633af', 'c30ab4db12a8881b'],
  'funnel:panel:intro': ['6071a81289a79132', 'ed16a6f2c26d6d38', 'ec9568449e2ef2c4', 'cd37fe7db62ecba0', '2e208fd5937bdb1f'],
  'funnel:panel:section': ['bd12c5794fe33393', 'b02c1064467bdd7a', 'abca3790861e33be', '0d9ee053d23ec532', 'd8e8a6a28979142d'],
  'funnel:awards:outline': ['55d3d425c4af7d53', 'de87258dd8fd31fb'],
  'funnel:awards:intro': ['6fed0c03b78658a3', 'bc7a8de70330a133', '1a20e24978a4cf9a', 'da94acceb387f386', '66ce80fe4691413d'],
  'funnel:awards:section': ['1a2ab116ed338e9c', 'e63fdf0418de8686', '760b0fefb22a92e2', '6e2a9440099f4ece', 'e382695afd08bd91'],
  'funnel:opening:outline': ['1d53aa130fd31ebd', '7c3104fd592edc8b'],
  'funnel:opening:intro': ['f568d9151a2e3582', '606486ea3208ec86', 'ec3f944d570564d6', '369ce9592153078a', 'e179945691de1c53'],
  'funnel:opening:section': ['26399580938638f3', '22b67b16893ed0cf', '2089193edbdd0fc3', '2773b2a6010684e7', 'e31afa2b1f7e9270'],
  'funnel:note:outline': ['00ba6f19612bd6ba', '6bebea721fc4eea6'],
  'funnel:note:intro': ['165f868cd4a7ad48', 'f6527293d797119c', '980cac900d4eeedc', '948dcf5ef035a7d8', 'fadca7268fbd729b'],
  'funnel:note:section': ['06dccc7c8623d84d', 'e07faf7aa9c702e9', '0c1428e5a65c6ffd', '2f6a5abbdbd18031', '1c7745174a64e568'],
};

test('the fixture is production revision 1', () => {
  const fixture = revisionOne();
  assert.equal(pipelineRevision(fixture).hash, '5c6ac3d9ad176ee9');
  assert.equal(fixture.funnels, undefined);
});

test('every current default is known', () => {
  for (const key of PRESET_PROMPT_KEYS) {
    const hash = promptHash(currentDefaultPrompt(key, MODEL));
    assert.ok(KNOWN_DEFAULT_PROMPTS[key].includes(hash), `add ${hash} to KNOWN_DEFAULT_PROMPTS['${key}']`);
  }
});

test('shipped defaults are never dropped', () => {
  for (const [key, hashes] of Object.entries(SHIPPED))
    for (const hash of hashes) assert.ok(KNOWN_DEFAULT_PROMPTS[key as keyof typeof KNOWN_DEFAULT_PROMPTS].includes(hash), `${key} lost ${hash}`);
});

test('an untouched revision 1 moves to 3.0 and keeps its models', () => {
  const fixture = revisionOne();
  const { next, updated, added, kept } = upgradePreset(fixture);
  assert.deepEqual(updated, ['system', ...PIPELINE_STEP_KEYS]);
  assert.deepEqual(kept, []);
  assert.deepEqual(added, []);
  assert.ok(next.systemPrompt.startsWith('Reporter IA — prompts editoriais 3.0'));
  for (const key of PIPELINE_STEP_KEYS) {
    assert.deepEqual({ ...next.steps[key], prompt: '' }, { ...fixture.steps[key], prompt: '' }, key);
    assert.equal(next.steps[key].prompt, currentDefaultPrompt(key, MODEL), key);
  }
  assert.equal(next.steps.material.maxTokens, 2048);
  assert.equal(next.funnels, undefined);
  assert.equal(next.articleMode, fixture.articleMode);
  assert.equal(next.curateQuotes, fixture.curateQuotes);
  // The stored revision is never changed in place.
  assert.equal(pipelineRevision(fixture).hash, '5c6ac3d9ad176ee9');
});

test('a second upgrade changes nothing', () => {
  const first = upgradePreset(revisionOne()).next;
  const second = upgradePreset(first);
  assert.deepEqual([second.updated, second.added, second.kept], [[], [], []]);
  assert.deepEqual(second.next, first);
});

test('a customised step is kept', () => {
  const fixture = revisionOne();
  fixture.steps.quotes.prompt += '\nMinha regra.';
  const { next, updated, kept } = upgradePreset(fixture);
  assert.deepEqual(kept, ['quotes']);
  assert.ok(!updated.includes('quotes'));
  assert.equal(updated.length, 10);
  assert.equal(next.steps.quotes.prompt, fixture.steps.quotes.prompt);
});

test('current defaults need nothing', () => {
  const definition = defaultPipelineDefinition(MODEL);
  const { next, updated, added, kept } = upgradePreset(definition);
  assert.deepEqual([updated, added, kept], [[], [], []]);
  assert.deepEqual(next, definition);
});

test('a stored funnel with a previous default follows the new text and keeps its model; a custom funnel stays', () => {
  const old = 'ABERTURA — COBERTURA DE ESTANDE (texto padrão antigo)\n{{source}} {{outline}} {{sizing}}';
  const custom = 'Minha estrutura de painel {{source}} {{brief}}';
  const definition: PipelineDefinition = { ...defaultPipelineDefinition(MODEL), funnels: {
    stand: { intro: { prompt: old, model: 'openai/gpt-4.1', temperature: 0.4, maxTokens: 4096 } },
    panel: { outline: { prompt: custom, model: MODEL, temperature: 0.2, maxTokens: 8192 } },
  } };
  const known = { ...KNOWN_DEFAULT_PROMPTS, 'funnel:stand:intro': [...KNOWN_DEFAULT_PROMPTS['funnel:stand:intro'], promptHash(old)] };
  const { next, updated, kept } = upgradePreset(definition, known);
  assert.deepEqual(updated, ['funnel:stand:intro']);
  assert.deepEqual(kept, ['funnel:panel:outline']);
  assert.deepEqual(next.funnels?.stand?.intro, { prompt: defaultFunnelPrompt('stand', 'intro'), model: 'openai/gpt-4.1', temperature: 0.4, maxTokens: 4096 });
  assert.equal(next.funnels?.panel?.outline?.prompt, custom);
  // Without the hash it is someone's text, and it stays.
  assert.deepEqual(upgradePreset(definition).kept, ['funnel:stand:intro', 'funnel:panel:outline']);
});

test('a missing step is added on the intro model', () => {
  const fixture = revisionOne();
  const steps: Partial<PipelineDefinition['steps']> = { ...fixture.steps };
  delete steps.images; delete steps.assist;
  const { next, added, updated } = upgradePreset({ ...fixture, steps: steps as PipelineDefinition['steps'] });
  assert.deepEqual(added, ['assist', 'images']);
  assert.ok(!updated.includes('images') && !updated.includes('assist'));
  assert.deepEqual(next.steps.images, defaultPipelineDefinition(fixture.steps.intro.model).steps.images);
  // The assistant joins on the article's model, as when a draft first gets it (withArticleAssist).
  assert.equal(next.steps.assist.model, fixture.steps.article.model);
  assert.equal(next.steps.assist.prompt, currentDefaultPrompt('assist', MODEL));
});

test('promptDefaultState reads current, previous and custom', () => {
  const fixture = revisionOne();
  assert.equal(promptDefaultState('intro', currentDefaultPrompt('intro', MODEL), MODEL), 'current');
  assert.equal(promptDefaultState('intro', fixture.steps.intro.prompt, MODEL), 'previous');
  assert.equal(promptDefaultState('system', fixture.systemPrompt, MODEL), 'previous');
  assert.equal(promptDefaultState('intro', fixture.steps.intro.prompt + ' ', MODEL), 'custom');
  assert.equal(promptDefaultState('funnel:note:quotes', defaultFunnelPrompt('note', 'quotes'), MODEL), 'current');
  assert.equal(promptDefaultState('funnel:note:quotes', 'Outro texto', MODEL), 'custom');
});
