'use client';
import { useWorkspaceHref } from '@/ui/workspace-navigation';

import type { ReactNode } from 'react';
import {
  AttachedNote,
  Avatar,
  Badge,
  BrandMark,
  Card,
  CardLink,
  Grid,
  MediaFrame,
  SkeletonRegion,
} from '@content-ventures/design-system/v3';
import { TriangleAlert } from '@content-ventures/design-system/v3/icons';
import { distribute, markName, photoHref, PORTAL_NAME, tileNote } from './images-model';
import type { Photo } from './images-model';

/**
 * The bank's photo grids, built only from DS parts. The mosaic is a masonry of four columns: a 1:1
 * grid of two 1:1 halves, each photo in the shortest column (no measuring, so the server and the
 * browser agree). A half narrower than 480 px stacks its two columns: the phone shows two.
 */

const COLUMNS = 4;

function MosaicColumns({ label, columns }: { label: string; columns: ReactNode[][] }) {
  const halves = [columns.slice(0, 2), columns.slice(2, 4)];
  return (
    <Grid columns="1:1" gap="sm" collapseBelow={false} align="start" as="section" label={label}>
      {halves.map((half, at) => (
        <Grid key={at} columns="1:1" gap="sm" collapseBelow={480} align="start">
          {half.map((column, index) => (
            <Grid key={index} columns="auto" min={10000} gap="sm" align="start" as="ul">
              {column}
            </Grid>
          ))}
        </Grid>
      ))}
    </Grid>
  );
}

/** Photos in their own proportions, no text: the note says only what blocks an archive photo (REQ-2.9). */
export function PhotoMosaic({ photos, search, label = 'Resultados' }: { photos: readonly Photo[]; search: string; label?: string }) {
  const columns = distribute(photos, COLUMNS).map((column) => column.map((photo) => <PhotoTile key={photo.key} photo={photo} search={search} />));
  return <MosaicColumns label={label} columns={columns} />;
}

function PhotoTile({ photo, search }: { photo: Photo; search: string }) {
  const workspaceHrefFor = useWorkspaceHref();
  const note = tileNote(photo);
  const tile = (
    <Card as="article" interactive padding="none">
      <CardLink href={workspaceHrefFor(photoHref(photo.key, search))} aria-label={`${photo.title} — ${photo.credit.trim() || 'sem crédito'}`}>
        <MediaFrame src={photo.preview} ratio={`${photo.width}/${photo.height}`} alt={photo.title} radius="lg" />
      </CardLink>
    </Card>
  );
  return note ? <AttachedNote tone={note.tone} icon={TriangleAlert} note={note.note}>{tile}</AttachedNote> : tile;
}

/**
 * "Grade": the same photos cut to 4:3, each with one quiet line: the bank's (or the portal's) mark
 * and the credit as it is published; a photo that cannot go into an article shows its status there
 * instead. One line for every tile, so a row keeps one height; the title stays in the link's name.
 */
export function PhotoGrid({ photos, search }: { photos: readonly Photo[]; search: string }) {
  return (
    <Grid columns="auto" min={220} as="ul" label="Resultados">
      {photos.map((photo) => <PhotoCard key={photo.key} photo={photo} search={search} />)}
    </Grid>
  );
}

/** Who made the photo, on its page: a person is an Avatar; the portal's own photo, its BrandMark. */
export function PhotoAuthorMark({ photo, size }: { photo: Photo; size: 'sm' | 'md' }) {
  return photo.creator
    ? <Avatar name={photo.creator} size={size} decorative />
    : <BrandMark name={PORTAL_NAME} size={size} variant="soft" decorative />;
}

function PhotoCard({ photo, search }: { photo: Photo; search: string }) {
  const workspaceHrefFor = useWorkspaceHref();
  const note = tileNote(photo);
  const credit = photo.credit.trim();
  const line = note
    ? <Badge variant="text" size="sm" tone={note.tone}>{note.note}</Badge>
    : <><BrandMark name={markName(photo)} size="xs" variant="soft" decorative /> {credit}</>;
  return (
    <Card as="article" interactive padding="sm">
      <CardLink href={workspaceHrefFor(photoHref(photo.key, search))} aria-label={`${photo.title} — ${credit || 'sem crédito'}`}>
        <MediaFrame src={photo.preview} alt={photo.title} ratio="4/3" radius="sm" caption={line} />
      </CardLink>
    </Card>
  );
}

const SKELETON_RATIOS = ['4/5', '3/2', '1/1', '16/9', '2/3', '3/2', '4/5', '1/1', '3/2', '2/3', '16/9', '4/5'];

/** Twelve loading frames in the same columns, so nothing jumps when the photos arrive. */
export function MosaicSkeleton({ label = 'Carregando imagens' }: { label?: string }) {
  const frames = SKELETON_RATIOS.map((ratio, index) => {
    const [width = 1, height = 1] = ratio.split('/').map(Number);
    return { ratio, width, height, index };
  });
  const columns = distribute(frames, COLUMNS).map((column) => column.map((frame) => (
    <MediaFrame key={frame.index} ratio={frame.ratio} state="loading" alt={label} radius="lg" />
  )));
  return (
    <SkeletonRegion label={label}>
      <MosaicColumns label={label} columns={columns} />
    </SkeletonRegion>
  );
}
