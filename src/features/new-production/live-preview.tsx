/**
 * The live preview ("Como o artigo nasce") left Nova produção with the 3-step redesign (CONTRACT
 * §3.9). Nothing imports this module any more: the speaker helpers moved to `preview-speakers.ts`.
 * Kept as a re-export only until the file can be deleted.
 */
export { usePreviewSpeakers, type PreviewSpeaker } from './preview-speakers';
