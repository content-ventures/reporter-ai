import type { AssetId, ImageAsset, IsoDateTime, PersonId, ProductionId } from '../domain/index.ts';
import { WORKSPACE_ID } from './people.ts';

/**
 * Images of the example workspace, in the shape the asset store seeds from (structural, so
 * fixtures never import adapters). They are drawn for the demo — product shots of the fictional
 * brands and the library's sample photo — and served by the app from `public/samples/`; the store
 * lists them like any upload and reads their bytes from that address when a package needs them.
 */

export type FixtureImage = { productionId: ProductionId; asset: ImageAsset; src: string };

/** A file in `public/samples/`, with what an upload would have measured. */
type SampleFile = { file: string; width: number; height: number; bytes: number };

const SAMPLES_PATH = '/samples/';

export const SAMPLE_FILES = {
  bellaPassoPair: { file: 'bella-passo-par.jpg', width: 1920, height: 1080, bytes: 251_540 },
  bellaPassoInsoles: { file: 'bella-passo-palmilhas.jpg', width: 1800, height: 1200, bytes: 260_300 },
  bellaPassoKit: { file: 'bella-passo-kit.jpg', width: 1200, height: 1500, bytes: 183_809 },
  coffeeBeans: { file: 'cafe-em-graos.jpg', width: 1600, height: 1600, bytes: 355_101 },
} as const satisfies Record<string, SampleFile>;

export function sampleSrc(sample: SampleFile): string {
  return `${SAMPLES_PATH}${sample.file}`;
}

/** An uploaded image of a production, credited and authorised (the brand's press kit). */
export function fixtureImage(
  productionId: ProductionId,
  id: AssetId,
  sample: SampleFile,
  { credit, at, by }: { credit: string; at: IsoDateTime; by: PersonId },
): FixtureImage {
  return {
    productionId,
    src: sampleSrc(sample),
    asset: {
      id,
      workspaceId: WORKSPACE_ID,
      kind: 'image',
      origin: { type: 'upload', fileName: sample.file },
      mime: 'image/jpeg',
      width: sample.width,
      height: sample.height,
      bytes: sample.bytes,
      credit,
      rights: { authorized: true },
      createdAt: at,
      createdBy: by,
    },
  };
}

/**
 * The library's sample photo: drawn under the sample copy (a coffee cooperative) by the models that
 * use the article's image, so a photo model shows a photo. Every slide that draws it says
 * "Foto de exemplo"; it never enters a production.
 */
export const SAMPLE_PHOTO = { assetId: 'img-amostra-cafe', src: sampleSrc(SAMPLE_FILES.coffeeBeans), credit: 'Foto de exemplo' } as const;
