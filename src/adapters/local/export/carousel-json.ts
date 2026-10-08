import type { CarouselBody } from '../../../domain/carousel.ts';
import type { PieceId, TemplateId, VersionId } from '../../../domain/ids.ts';
import type { Version } from '../../../domain/piece.ts';

/** Carousel version as portable JSON: what a vendor renderer or a scheduler (R6) consumes. */
export type CarouselExport = {
  schema: 'reporter.carousel/v1';
  pieceId: PieceId;
  versionId: VersionId;
  version: number;
  hash: string;
  templateId: TemplateId;
  derivedFrom: { pieceId: PieceId; version: number; hash: string }[];
  slides: { index: number; layout: string; slots: Record<string, string>; sourceBlockIds: string[] }[];
};

export function carouselJson(version: Version, body: CarouselBody): CarouselExport {
  return {
    schema: 'reporter.carousel/v1',
    pieceId: version.pieceId,
    versionId: version.id,
    version: version.number,
    hash: version.hash,
    templateId: body.templateId,
    derivedFrom: version.inputs.map((input) => ({ pieceId: input.pieceId, version: input.number, hash: input.hash })),
    slides: body.slides.map((slide, index) => ({
      index: index + 1,
      layout: slide.layout,
      slots: Object.fromEntries(Object.entries(slide.slots).map(([key, value]) => [key, value.trim()])),
      sourceBlockIds: [...slide.sourceBlockIds],
    })),
  };
}
