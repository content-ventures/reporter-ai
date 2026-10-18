'use client';

import { useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  Badge,
  BrandMark,
  Button,
  ButtonLink,
  CardHeader,
  DescriptionList,
  EmptyState,
  MediaFrame,
  MetaList,
  PageHeader,
  PageStack,
  Panel,
  Section,
  SkeletonRegion,
  SplitLayout,
  TextLink,
  toast,
} from '@content-ventures/design-system/v3';
import type { DescriptionItem } from '@content-ventures/design-system/v3';
import { ExternalLink, ImagePlus, Newspaper, Pencil, SearchX } from '@content-ventures/design-system/v3/icons';
import { imageUsable } from '@/domain/hard-news';
import type { ArchiveImage } from '@/domain/hard-news';
import { formatDate, plural } from '@/ui/format';
import { pieceHref } from '@/ui/routes';
import { useBreadcrumb } from '@/ui/shell';
import { BANK_PHOTOS } from '../preview/image-bank';
import { ImageDrawer } from './image-drawer';
import {
  archiveCopy,
  BANK_LICENSES,
  blockedReason,
  DEFAULT_IMAGE_PARAMS,
  formatPixels,
  fromArchive,
  imagesHref,
  licenseLabel,
  markName,
  ORIENTATION_LABELS,
  orientationOf,
  parseImageParams,
  photosFor,
  photoState,
  PORTAL_NAME,
  providerOf,
  resolvePhoto,
  rightsBadge,
  serializeImageParams,
  similarPhotos,
  SOURCE_LABELS,
} from './images-model';
import type { Photo } from './images-model';
import { PhotoAuthorMark, PhotoMosaic } from './photo-mosaic';
import { BANK_POOL, useArchive } from './use-image-bank';
import { PLACEMENT_LABELS, UseInArticleDrawer } from './use-in-article-drawer';
import type { ArticleUse } from './use-in-article-drawer';

/** The photo page with the bank's search kept for the way back (inside `<Suspense>`). */
export function PhotoScreenFromUrl() {
  const searchParams = useSearchParams();
  return <PhotoScreen search={serializeImageParams(parseImageParams(searchParams))} />;
}

function decoded(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** A theme of the photo, searched in the whole bank. */
function themeHref(tag: string): string {
  return imagesHref(serializeImageParams({ ...DEFAULT_IMAGE_PARAMS, q: tag }));
}

/**
 * The page of one photo (F2.9), as banks show it: the photo large, who made it, its license and
 * details, its themes and similar photos. The main action follows its rights: a bank photo is saved
 * to the archive; an archive photo goes into an article only when credited and cleared (REQ-2.9).
 */
export function PhotoScreen({ search = '' }: { search?: string }) {
  const { id } = useParams<{ id: string }>();
  const key = decoded(id);
  const { images: archive, ready, save } = useArchive();
  const photo = useMemo(() => (ready ? resolvePhoto(key, archive, BANK_PHOTOS) : undefined), [ready, key, archive]);
  const back = imagesHref(search);
  useBreadcrumb(ready ? [{ label: 'Imagens', href: back }, { label: photo?.title ?? 'Foto não encontrada' }] : null);

  if (!ready) {
    return (
      <PageStack>
        <SkeletonRegion label="Carregando a foto">
          <MediaFrame ratio="3/2" state="loading" alt="Carregando a foto" radius="lg" />
        </SkeletonRegion>
      </PageStack>
    );
  }
  if (!photo) {
    return (
      <EmptyState
        icon={SearchX}
        size="page"
        heading="h1"
        title="Foto não encontrada"
        actions={<ButtonLink href={back}>Voltar para Imagens</ButtonLink>}
      />
    );
  }
  return <PhotoPage photo={photo} archive={archive} search={search} save={save} />;
}

function PhotoPage({ photo, archive, search, save }: { photo: Photo; archive: ArchiveImage[]; search: string; save: (image: ArchiveImage) => void }) {
  const router = useRouter();
  const noteId = useId();
  const [editing, setEditing] = useState<{ open: boolean; session: number }>();
  const [using, setUsing] = useState<{ open: boolean; session: number }>();
  const state = photoState(photo);
  const badge = rightsBadge(photo);
  const reason = blockedReason(state);
  const image = photo.image;
  const pool = useMemo(
    () => photosFor('all', { own: archive.map(fromArchive), unsplash: BANK_POOL.unsplash, pexels: BANK_POOL.pexels }, archive),
    [archive],
  );
  const similar = useMemo(() => similarPhotos(photo, pool, 12), [photo, pool]);

  function openUse() {
    setUsing((previous) => ({ open: true, session: (previous?.session ?? 0) + 1 }));
  }

  function openEdit() {
    setEditing((previous) => ({ open: true, session: (previous?.session ?? 0) + 1 }));
  }

  function saveToArchive() {
    if (!photo.bank) return;
    // One archive copy per bank photo: saving twice updates the same record.
    save(archiveCopy(photo.bank, `img-${photo.source}-${photo.id}`));
    toast('Foto salva no acervo', { action: { label: 'Usar em artigo', onClick: openUse } });
  }

  function saveEdit(next: ArchiveImage) {
    save(next);
    setEditing((previous) => ({ open: false, session: previous?.session ?? 0 }));
    toast('Imagem salva', imageUsable(next) ? undefined : { tone: 'info', description: 'Ela só vai para artigos depois de confirmar os direitos.' });
  }

  function use(choice: ArticleUse) {
    if (!image) return;
    save({ ...image, uses: image.uses + 1 });
    setUsing((previous) => ({ open: false, session: previous?.session ?? 0 }));
    toast(`Imagem enviada para ${choice.title}`, {
      description: PLACEMENT_LABELS[choice.placement],
      action: { label: 'Abrir artigo', onClick: () => router.push(pieceHref(choice.productionId, 'article')) },
    });
  }

  const bankName = photo.source === 'own' ? undefined : SOURCE_LABELS[photo.source];
  const actions: ReactNode = state === 'bank' ? (
    <>
      <Button variant="primary" icon={ImagePlus} onClick={saveToArchive}>Salvar no acervo</Button>
      {photo.sourceUrl ? (
        <ButtonLink href={photo.sourceUrl} target="_blank" rel="noopener noreferrer" trailingIcon={ExternalLink}>{`Ver no ${bankName}`}</ButtonLink>
      ) : null}
    </>
  ) : state === 'ready' ? (
    <>
      <Button variant="primary" icon={Newspaper} onClick={openUse}>Usar em artigo</Button>
      <Button icon={Pencil} onClick={openEdit}>Editar créditos</Button>
    </>
  ) : (
    <>
      <Button variant="primary" icon={Pencil} onClick={openEdit}>Editar créditos</Button>
      <Button icon={Newspaper} aria-disabled aria-describedby={noteId}>Usar em artigo</Button>
    </>
  );

  return (
    <>
      <PageStack>
        <PageHeader
          title={photo.title}
          status={<Badge variant="text" tone={badge.tone}>{badge.label}</Badge>}
          meta={[SOURCE_LABELS[photo.source], { value: formatPixels(photo), numeric: true }]}
          actions={actions}
          actionsNote={reason ? { id: noteId, text: reason } : undefined}
        />
        <SplitLayout
          asideLabel="Sobre a foto"
          main={<MediaFrame src={photo.full} ratio={`${photo.width}/${photo.height}`} fit="contain" fitHeight alt={photo.title} radius="lg" />}
          aside={<PhotoFacts photo={photo} />}
        />
        {similar.length > 0 ? (
          <Section title="Imagens parecidas" action={<TextLink href={themeHref(photo.tags[0] ?? photo.title)}>Ver todas</TextLink>}>
            <PhotoMosaic photos={similar} search={search} label="Imagens parecidas" />
          </Section>
        ) : null}
      </PageStack>
      {image && editing ? (
        <ImageDrawer
          key={editing.session}
          image={image}
          open={editing.open}
          onClose={() => setEditing({ ...editing, open: false })}
          onSave={saveEdit}
        />
      ) : null}
      {using ? (
        <UseInArticleDrawer
          key={using.session}
          photo={photo}
          open={using.open && state === 'ready'}
          onClose={() => setUsing({ ...using, open: false })}
          onUse={use}
        />
      ) : null}
    </>
  );
}

/** The side panel: author, license and credit, details and themes. */
function PhotoFacts({ photo }: { photo: Photo }) {
  const image = photo.image;
  const provider = providerOf(photo);
  const bankName = provider ? SOURCE_LABELS[provider] : undefined;
  const credit = photo.credit.trim();
  const license = provider && photo.licenseUrl && licenseLabel(photo) === BANK_LICENSES[provider].label
    ? <TextLink external href={photo.licenseUrl}>{licenseLabel(photo)}</TextLink>
    : licenseLabel(photo);
  const details: DescriptionItem[] = [
    { label: 'Fonte', value: bankName ?? SOURCE_LABELS.own, leading: <BrandMark name={markName(photo)} size="xs" variant="soft" decorative /> },
    { label: 'Dimensões', value: formatPixels(photo), numeric: true },
    { label: 'Orientação', value: ORIENTATION_LABELS[orientationOf(photo)] },
    ...(image ? [
      { label: 'Data', value: image.takenOn ? formatDate(image.takenOn) : undefined, numeric: true },
      { label: 'Usada em', value: image.uses > 0 ? plural(image.uses, 'matéria', 'matérias') : 'Nenhuma matéria' },
    ] : []),
  ];
  return (
    <Panel>
      <Section title="Autor">
        <CardHeader
          size="md"
          leading={<PhotoAuthorMark photo={photo} size="md" />}
          title={photo.creator ?? PORTAL_NAME}
          description={photo.creator && photo.creatorUrl && bankName
            ? <TextLink external tone="quiet" href={photo.creatorUrl}>{`Perfil no ${bankName}`}</TextLink>
            : SOURCE_LABELS.own}
        />
      </Section>
      <Section title="Direitos">
        <DescriptionList
          labelWidth={96}
          items={[
            { label: 'Licença', value: license },
            { label: 'Crédito', value: credit || undefined, copy: credit || undefined, state: credit ? undefined : 'missing' },
          ]}
        />
      </Section>
      <Section title="Detalhes">
        <DescriptionList labelWidth={96} items={details} />
      </Section>
      {photo.tags.length > 0 ? (
        <Section title="Temas">
          <MetaList items={photo.tags.map((tag) => <TextLink key={tag} tone="text" href={themeHref(tag)}>{tag}</TextLink>)} />
        </Section>
      ) : null}
    </Panel>
  );
}
