/**
 * Preset upgrades of the editorial prompts. A saved revision keeps the default texts of the day it
 * was saved: a newer preset never reaches it silently, because a running revision is immutable
 * (`activePipeline` never calls this module). An admin applies a preset on the Prompts page, which
 * saves the result as a new revision.
 *
 * A stored prompt is recognised as untouched when its text hashes to a default some release
 * shipped (`KNOWN_DEFAULT_PROMPTS`); anything else is a customisation and is kept as it is.
 */
import { contentHash } from './text/hash.ts';
import { EDITORIAL_FORMATS, type EditorialFormat } from './formats.ts';
import { FUNNEL_STEP_KEYS, defaultFunnelPrompt, type FunnelStepKey } from './format-prompts.ts';
import { PIPELINE_STEP_KEYS, compactFunnels, defaultPipelineDefinition, withArticleAssist } from './pipeline.ts';
import type { PipelineDefinition, PipelineModel, PipelineStep, PipelineStepKey } from './pipeline.ts';
import { funnelPromptKey, type FunnelPromptKey } from './pipeline-workers.ts';

export const PRESET_VERSION = '3.0';

/** The same keys as the prompts of the Prompts page. */
export type PresetPromptKey = 'system' | PipelineStepKey | FunnelPromptKey;
export const PRESET_PROMPT_KEYS: readonly PresetPromptKey[] = ['system', ...PIPELINE_STEP_KEYS,
  ...EDITORIAL_FORMATS.flatMap(format => FUNNEL_STEP_KEYS.map(step => funnelPromptKey(format, step)))];

export function promptHash(text: string): string { return contentHash(text); }

function funnelOf(key: PresetPromptKey): { format: EditorialFormat; step: FunnelStepKey } | undefined {
  if (!key.startsWith('funnel:')) return undefined;
  const [, format, step] = key.split(':') as [string, EditorialFormat, FunnelStepKey];
  return { format, step };
}

// The defaults are pure functions of the model: built once per model, never handed out.
const defaultsByModel = new Map<PipelineModel, PipelineDefinition>();
function defaultsOf(model: PipelineModel): PipelineDefinition {
  let defaults = defaultsByModel.get(model);
  if (!defaults) { defaults = defaultPipelineDefinition(model); defaultsByModel.set(model, defaults); }
  return defaults;
}

/** The default text this build ships for a prompt. */
export function currentDefaultPrompt(key: PresetPromptKey, model: PipelineModel): string {
  const funnel = funnelOf(key);
  if (funnel) return defaultFunnelPrompt(funnel.format, funnel.step);
  const defaults = defaultsOf(model);
  return key === 'system' ? defaults.systemPrompt : defaults.steps[key as PipelineStepKey].prompt;
}

/**
 * Every default text ever shipped, per prompt, as `promptHash`. A changed default appends its hash;
 * never delete one (tests enforce both). The last hash of each list is this build's default (preset 3.0).
 */
export const KNOWN_DEFAULT_PROMPTS: Readonly<Record<PresetPromptKey, readonly string[]>> = {
  // Production revision 1 (up to v0.4.0), then v0.5.0–v0.14.0.
  system: ['669ee81a08ea5915', '2534ab151043d1c5', '0c970cc1e6cbc8b2', '2b87bf6286932c4c'],
  material: ['f2b461021e0b5c11', '6b9bfa8060fcf2b6'],
  facts: ['6558b17d9d797766', '295928a1918a0e49'],
  outline: ['e5203e280fee131e', '9e4c72ad919acb04', '4445327119422ca9'],
  quotes: ['80d9eaf28f5ffad7', 'dc4da6b485fd6dbe', '6a42ff28515dc30e', 'bec2ff97d7070938'],
  intro: ['2369abf2e11a5efd', 'b221e8c51a52d9a3', '65999fd2cbcf956e', '4a6e9e8d94462a57', '773cc328ca7a29a7', '3373c22f5f7880d9'],
  section: ['dee060967f886971', '65d0d5d891a6f1fc', 'a1c067a739fcb2ee', '341985903195a0c7', 'bded3e9b7b26149f', '3a78aae6ef08d04d', 'a80fbdfd4adb7c2e'],
  article: ['daaa232019f19657', '522cea1f71f21043', '3d08a5799cb73112'],
  assist: ['38867eb4b4bba83d', 'e32c54e92f3a7801'],
  images: ['6068d8ef38d2cf73', 'c988ebb8cc482094'],
  carousel: ['9cedc2c5c9e818f6', '6172c117be9e19af', 'c443c16324b95cf8'],
  'funnel:stand:outline': ['ea8f2d1adadeed6f', '1421e239c15ffc51', '2bc03d67f6ddb5a2', 'c44bafc495211542', 'e86ef26109ba12dc', 'b1f5eed19373980b'],
  'funnel:stand:quotes': ['635ddafb9444bd1e', 'af4de8db439af90a'],
  'funnel:stand:intro': ['c11ca073650066cb', 'b0f6a6b6eeb52f69', '3cf22b4b80f421f5', 'c7d7b912bad7cb88', '701284b367713b5b', '3bdae37ab603cbfb', 'ac72b797bc4a4587', 'c74bbb4fb28abc3b', 'fb065860a38f53c3', '1ad754542a2999dd'],
  'funnel:stand:section': ['87d1c11b9480ec22', '365106dc822e3fcf', '3bfa1b6c22e5f49f', 'f4c08defc3e8fbc3', '17aec6140f0115da', 'e7699dd88d1dda8e', '66444d728f5f8421', '3241c3ecdf0e66b9', '42fc296da9b84eeb', '89504d4c98ea5f69'],
  'funnel:panel:outline': ['d828f87a79d633af', 'c30ab4db12a8881b', '966cf6a8f9f7a452', '72fb318a2032288c', '8754da51e1dedcd7'],
  'funnel:panel:quotes': ['62a5c03431441946', 'a2c5338b2e25fcc5', 'b58329ee9ea1cc19'],
  'funnel:panel:intro': ['6071a81289a79132', 'ed16a6f2c26d6d38', 'ec9568449e2ef2c4', 'cd37fe7db62ecba0', '2e208fd5937bdb1f', '28d03a84473c6228', 'f932a066f628ff20', '1e587d075dd157f4', '88768b501d9eccc5'],
  'funnel:panel:section': ['bd12c5794fe33393', 'b02c1064467bdd7a', 'abca3790861e33be', '0d9ee053d23ec532', 'd8e8a6a28979142d', 'ab63ae1d18b3fb30', '710647bbc0606f34', '1fffdaedffb6bf22', '225143c888500bc5'],
  'funnel:awards:outline': ['55d3d425c4af7d53', 'de87258dd8fd31fb', 'a891aa95d084ed38', '2debb3be8ea17f86', 'c610439f134ce3a0'],
  'funnel:awards:quotes': ['b0841e1cb73b73c6', '119540aab0788845', '7ac037df4909189a'],
  'funnel:awards:intro': ['6fed0c03b78658a3', 'bc7a8de70330a133', '1a20e24978a4cf9a', 'da94acceb387f386', '66ce80fe4691413d', '769f8bde6f542783', '53c2359f53a9e22b', '07e29bd29007e022', '7730ca08b2884787'],
  'funnel:awards:section': ['1a2ab116ed338e9c', 'e63fdf0418de8686', '760b0fefb22a92e2', '6e2a9440099f4ece', 'e382695afd08bd91', 'fbb71574b55a18b2', 'b9cbb0cc2fd94086', '534e99196875823d', 'e72fa4e0511a6396'],
  'funnel:opening:outline': ['1d53aa130fd31ebd', '7c3104fd592edc8b', 'ee48fdec6988871c', '50f803e231accf1a', 'c0998640c1c529a5'],
  'funnel:opening:quotes': ['e721132e396d1530', '4d575861daf7534b', '1e6125a687159c97'],
  'funnel:opening:intro': ['f568d9151a2e3582', '606486ea3208ec86', 'ec3f944d570564d6', '369ce9592153078a', 'e179945691de1c53', '299aa77240237256', '61ddcf3f081e997a', 'ba9a040e851188a7', '1a657b0c150b09c9'],
  'funnel:opening:section': ['26399580938638f3', '22b67b16893ed0cf', '2089193edbdd0fc3', '2773b2a6010684e7', 'e31afa2b1f7e9270', '52030e5536924d2c', 'd774df215757c7ac', '638ab7a0a7e435a5', '871b175097982b2b'],
  'funnel:note:outline': ['00ba6f19612bd6ba', '6bebea721fc4eea6', 'a14dba42b28efc3d', 'fce9b63cd2eeab49', 'd5aeeec7f245afc9'],
  'funnel:note:quotes': ['c0d55eaf73918b2f', '5310ee600a554e8e', 'ef8b6c369c811eab'],
  'funnel:note:intro': ['165f868cd4a7ad48', 'f6527293d797119c', '980cac900d4eeedc', '948dcf5ef035a7d8', 'fadca7268fbd729b', '53b217c180d273a0', 'b9e17418c6d835b8', 'e38f8dbaaba8e1c2', 'cd981bb2213088ef'],
  'funnel:note:section': ['06dccc7c8623d84d', 'e07faf7aa9c702e9', '0c1428e5a65c6ffd', '2f6a5abbdbd18031', '1c7745174a64e568', '42b8ad50a0170b94', '67aea8a59c44d814', '3237d29da3b8f418', 'eb30f612661de3bc'],
};

/** current: this build's default; previous: a default an earlier release shipped; custom: edited by someone. */
export type PromptDefaultState = 'current' | 'previous' | 'custom';

export function promptDefaultState(key: PresetPromptKey, text: string, model: PipelineModel, known = KNOWN_DEFAULT_PROMPTS): PromptDefaultState {
  if (text === currentDefaultPrompt(key, model)) return 'current';
  return known[key]?.includes(promptHash(text)) ? 'previous' : 'custom';
}

export type PresetUpgrade = { next: PipelineDefinition; updated: PresetPromptKey[]; added: PresetPromptKey[]; kept: PresetPromptKey[] };

/**
 * Move every untouched prompt to this build's default, keeping its model, temperature and token
 * limit; customised prompts and the flow (`articleMode`, `curateQuotes`) stay as they are. A step
 * the revision lacks is added with the default on its writing model. Running it twice changes
 * nothing. The caller saves `next` as a new revision; nothing here touches a stored one.
 */
export function upgradePreset(definition: PipelineDefinition, known = KNOWN_DEFAULT_PROMPTS): PresetUpgrade {
  const model = definition.steps.intro.model;
  const target = defaultPipelineDefinition(model);
  let next = structuredClone(definition);
  const updated: PresetPromptKey[] = [], added: PresetPromptKey[] = [], kept: PresetPromptKey[] = [];
  const stateOf = (key: PresetPromptKey, text: string) => promptDefaultState(key, text, model, known);

  const system = stateOf('system', next.systemPrompt);
  if (system === 'previous') { next.systemPrompt = target.systemPrompt; updated.push('system'); }
  else if (system === 'custom') kept.push('system');

  for (const key of PIPELINE_STEP_KEYS) {
    const step = next.steps[key] as PipelineStep | undefined;
    if (!step) {
      next = key === 'assist' ? withArticleAssist(next) : { ...next, steps: { ...next.steps, [key]: structuredClone(target.steps[key]) } };
      added.push(key);
      continue;
    }
    const state = stateOf(key, step.prompt);
    if (state === 'previous') { next.steps[key] = { ...step, prompt: target.steps[key].prompt }; updated.push(key); }
    else if (state === 'custom') kept.push(key);
  }

  // Only stored funnel steps: the others already follow the defaults of the running build.
  for (const format of EDITORIAL_FORMATS) for (const step of FUNNEL_STEP_KEYS) {
    const funnel = next.funnels?.[format], stored = funnel?.[step];
    if (!funnel || !stored) continue;
    const key = funnelPromptKey(format, step);
    const state = stateOf(key, stored.prompt);
    if (state === 'previous') { funnel[step] = { ...stored, prompt: defaultFunnelPrompt(format, step) }; updated.push(key); }
    else if (state === 'custom') kept.push(key);
  }

  return { next: compactFunnels(next), updated, added, kept };
}
