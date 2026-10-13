'use client';

import { useMemo } from 'react';
import { EditableTitle, ErrorState, LinkButton, List, ListItem, MetaList, PageStack, Prose, ReadingColumn, Seal, SkeletonText } from '@content-ventures/design-system/v3';
import { ImageOff } from '@content-ventures/design-system/v3/icons';
import { articleAssetIds, articleImageSlots, type ArticleBody } from '@/domain';
import { plural } from '@/ui/format';
import { EditorContent, useArticleReader } from '@/editor';
import type { DeliveryItemView } from '@/ports';
import { useVersion } from '@/state';
import { formatListDateTime } from '@/ui/format';
import { CoverImage } from '@/features/review/article-reading';
import { useImageSources } from '@/features/review/use-image-sources';

/**
 * "Artigo final" in Entrega: the approved article read as it leaves, before anyone downloads it — the
 * approval (seal, who and when) on the text's edge, the cover with its caption and credit, the
 * title and the text in reading typography (DS `Prose read`), figures with caption and credit.
 * Images the generation suggested and nobody filled are left out, as in the .md and the .html: one
 * line under the approval says how many and opens the package view, which lists them. One centred
 * column (DS `ReadingColumn`): the article sits in the middle of the screen.
 */
export function ArticleFinal({ item, onOpenPackage }: { item: DeliveryItemView; onOpenPackage?: () => void }) {
  const version = useVersion(item.version.versionId);
  const body = version.data?.body.type === 'article' ? version.data.body : undefined;
  const left = body ? articleImageSlots(body).length : 0;

  if (version.status === 'error') {
    return <ErrorState title="Não foi possível abrir o artigo" onRetry={version.retry} size="page" />;
  }

  return (
    <ReadingColumn>
      <List label="Aprovação" framed={false} dividers={false} bleed>
        <ListItem
          leading={<Seal label="" size="lg" still />}
          title={`${item.label} v${item.version.number} aprovado`}
          description={<MetaList size="sm" items={[item.approvedBy?.name ?? 'Aprovado', item.approvedAt ? formatListDateTime(item.approvedAt) : null]} />}
        />
        {left > 0 ? (
          <ListItem
            icon={ImageOff}
            title={`${plural(left, 'imagem sugerida ficou', 'imagens sugeridas ficaram')} de fora`}
            actions={onOpenPackage ? <LinkButton onClick={onOpenPackage}>Ver no pacote</LinkButton> : undefined}
          />
        ) : null}
      </List>
      {body ? <FinalText body={body} label={`${item.label} v${item.version.number}`} /> : <SkeletonText lines={12} lineHeight={28} label="Carregando o artigo" />}
    </ReadingColumn>
  );
}

function FinalText({ body, label }: { body: ArticleBody; label: string }) {
  const assetIds = useMemo(() => articleAssetIds(body), [body]);
  const images = useImageSources(assetIds);
  const editor = useArticleReader({ body, figureSources: images.figures, hideImageSlots: true });
  return (
    <Prose
      variant="read"
      as="article"
      label={label}
      header={
        <PageStack>
          {body.cover ? <CoverImage cover={body.cover} images={images} /> : null}
          {/* h2: the page's h1 is the production in the header line. */}
          <EditableTitle value={body.title} label="Título do artigo" size="document" as="h2" readOnly onCommit={() => undefined} />
        </PageStack>
      }
    >
      <EditorContent editor={editor} />
    </Prose>
  );
}
