'use client';
import { useWorkspaceHref } from '@/ui/workspace-navigation';

import { useMemo } from 'react';
import {
  Avatar,
  Button,
  ButtonLink,
  Drawer,
  EmptyState,
  ErrorState,
  formatRelative,
  List,
  ListItem,
  ListItemSkeleton,
  MetaList,
} from '@content-ventures/design-system/v3';
import type { TemplateInfo } from '@/ports';
import { formatName } from '@/features/library/library-model';
import { useProductions } from '@/state';
import { PRODUCTIONS_HREF } from '@/ui/routes';
import { carouselStartHref } from '../routes';
import { carouselTargets } from './templates-model';

/** The productions read for the list: the most recent first, as many as a desk keeps open. */
const FILTER = { sort: 'updated_desc' } as const;
const PAGE = { page: 1, size: 50 };
const SKELETON_ROWS = [0, 1, 2];

/**
 * "Criar carrossel": the productions whose article is approved and whose carousel has not started,
 * each opening the carousel's start with this model chosen. The list is the choice — no second
 * step; the start shows the cover in the model before anything is generated.
 */
export function StartDrawer({ template, open, onClose }: { template: TemplateInfo | undefined; open: boolean; onClose: () => void }) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      size="md"
      title="Criar carrossel"
      description={template ? <MetaList size="sm" items={[template.name, formatName(template.formatInfo)]} /> : undefined}
      closeLabel="Fechar"
      footer={<Button onClick={onClose}>Cancelar</Button>}
    >
      {open && template ? <Targets template={template} /> : null}
    </Drawer>
  );
}

function Targets({ template }: { template: TemplateInfo }) {
  const workspaceHrefFor = useWorkspaceHref();
  const productions = useProductions(FILTER, PAGE);
  const targets = useMemo(() => carouselTargets(productions.data?.items ?? []), [productions.data]);

  if (productions.status === 'loading') {
    return (
      <List label="Carregando as produções" framed={false} bleed>
        {SKELETON_ROWS.map((row) => (
          <ListItemSkeleton key={row} />
        ))}
      </List>
    );
  }
  if (productions.status === 'error' && !productions.data) {
    return <ErrorState size="inline" title="Não foi possível carregar as produções" onRetry={productions.retry} />;
  }
  if (targets.length === 0) {
    return (
      <EmptyState
        size="panel"
        heading="p"
        title="Nenhum artigo aprovado"
        description="O carrossel começa de um artigo aprovado."
        actions={
          <ButtonLink size="sm" href={workspaceHrefFor(PRODUCTIONS_HREF)}>
            Abrir produções
          </ButtonLink>
        }
      />
    );
  }
  return (
    <List label="Produções com artigo aprovado" framed={false} bleed>
      {targets.map((item) => (
        <ListItem
          key={item.id}
          leading={<Avatar name={item.owner.name} src={item.owner.avatarUrl} size="sm" decorative />}
          title={item.title}
          titleLines={2}
          description={item.situation.line}
          meta={formatRelative(item.updatedAt)}
          href={workspaceHrefFor(carouselStartHref(item.id, template.id))}
        />
      ))}
    </List>
  );
}
