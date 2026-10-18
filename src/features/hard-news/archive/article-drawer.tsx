'use client';

import { useRouter } from 'next/navigation';
import {
  Button,
  ButtonLink,
  DescriptionList,
  Drawer,
  List,
  ListGroup,
  ListItem,
  MediaFrame,
  PageStack,
  Section,
  StepPipeline,
} from '@content-ventures/design-system/v3';
import type { PipelineStage } from '@content-ventures/design-system/v3';
import { ExternalLink, Link2, RefreshCw, Search } from '@content-ventures/design-system/v3/icons';
import type { ArchiveArticle } from '@/domain/hard-news';
import { formatDate } from '@/ui/format';
import { pieceHref } from '@/ui/routes';
import { researchHref } from '../routes';
import { coverOf } from './archive-covers';
import { addressOf, storiesOf } from './archive-model';
import type { ArchiveUse } from './archive-model';

const USE_LABEL = { context: 'Apuração · contexto', suggested: 'Estúdio · link sugerido', inserted: 'Estúdio · link inserido' } as const;

/**
 * One published article: its cover, the passage and address it is cited with, its way into the AI
 * (published, read, used in stories) and every story that used it, each use a way into that story.
 */
export function ArticleDrawer({ article, uses, open, onClose, onResend }: {
  article?: ArchiveArticle;
  uses: readonly ArchiveUse[];
  open: boolean;
  onClose: () => void;
  onResend: (article: ArchiveArticle) => void;
}) {
  const router = useRouter();
  if (!article) return null;
  const cover = coverOf(article);
  const stories = storiesOf(uses);
  const read: PipelineStage['state'] = article.index === 'indexed' ? 'done' : article.index === 'failed' ? 'error' : 'current';
  const stages: PipelineStage[] = [
    { id: 'published', label: 'Publicada', state: 'done', detail: formatDate(article.publishedAt) },
    { id: 'read', label: 'Lida pela IA', state: read, detail: read === 'done' ? 'Pronta para consulta' : read === 'error' ? 'A leitura falhou' : 'Na fila' },
    { id: 'used', label: 'Usada em pautas', state: stories ? 'done' : 'upcoming', detail: stories ? `Em ${stories} ${stories === 1 ? 'pauta' : 'pautas'}` : 'Ainda não' },
  ];
  const byStory = [...new Set(uses.map((use) => use.productionId))].map((productionId) => uses.filter((use) => use.productionId === productionId));
  const go = (href: string) => {
    onClose();
    router.push(href);
  };
  return (
    <Drawer
      open={open}
      onClose={onClose}
      size="md"
      title={article.title}
      description={`${article.section} · ${formatDate(article.publishedAt)} · ${article.author}`}
      footer={(
        <>
          {article.index === 'failed' ? <Button variant="secondary" icon={RefreshCw} onClick={() => onResend(article)}>Reenviar para a IA</Button> : null}
          <ButtonLink href={article.url} target="_blank" rel="noopener noreferrer" variant={article.index === 'failed' ? 'ghost' : 'secondary'} trailingIcon={ExternalLink}>Abrir no portal</ButtonLink>
        </>
      )}
    >
      <PageStack>
        <MediaFrame src={cover?.src} alt={cover?.alt ?? article.title} ratio="16/9" radius="md" />
        <DescriptionList
          labelWidth={96}
          label="Matéria"
          items={[
            { label: 'Trecho', value: article.excerpt },
            { label: 'Endereço', value: addressOf(article.url), copy: article.url },
          ]}
        />
        <StepPipeline variant="journey" label="Caminho da matéria na IA" stages={stages} />
        <Section title="Pautas que usaram" titleAs="h3" meta={stories ? String(stories) : undefined}>
          <List label="Pautas que usaram" framed={false} bleed empty="Nenhuma pauta usou esta matéria.">
            {byStory.map((story) => (
              <ListGroup key={story[0].productionId} label={story[0].story}>
                {story.map((use) => (
                  <ListItem
                    key={`${use.productionId}-${use.kind}`}
                    density="sm"
                    icon={use.kind === 'context' ? Search : Link2}
                    title={USE_LABEL[use.kind === 'context' ? 'context' : use.state ?? 'suggested']}
                    onClick={() => go(use.kind === 'context' ? researchHref(use.productionId) : pieceHref(use.productionId, 'article'))}
                  />
                ))}
              </ListGroup>
            ))}
          </List>
        </Section>
      </PageStack>
    </Drawer>
  );
}
