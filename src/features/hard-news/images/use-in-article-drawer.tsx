'use client';

import { useId, useMemo, useState } from 'react';
import {
  Avatar,
  BrandMark,
  Button,
  DescriptionList,
  Drawer,
  Field,
  FieldGroup,
  formatRelative,
  List,
  ListItem,
  MediaFrame,
  PageStack,
  SearchField,
  Segmented,
  Textarea,
  TruncatedText,
} from '@content-ventures/design-system/v3';
import { Newspaper } from '@content-ventures/design-system/v3/icons';
import type { DossierStage } from '@/domain/hard-news';
import { plural } from '@/ui/format';
import { useHardNews } from '../state/hard-news-provider';
import { licenseLabel, markName, normalize } from './images-model';
import type { Photo } from './images-model';

const STAGE_LABELS: Record<DossierStage, string> = { research: 'Apuração', writing: 'Escrevendo', article: 'Artigo' };

export type Placement = 'cover' | 'body';

export const PLACEMENT_LABELS: Record<Placement, string> = { cover: 'Capa', body: 'No texto' };

export type ArticleUse = { productionId: string; title: string; placement: Placement; caption: string };

/** With more productions than this, a search sits above the list. */
const SEARCH_FROM = 6;

type Production = { id: string; title: string; stage: string; person?: string; at?: string };

/** The desk's productions in progress, the most recently touched first. */
function useProductions(): Production[] {
  const { state } = useHardNews();
  return useMemo(
    () => Object.values(state.dossiers)
      .map((dossier) => {
        const news = state.news.find((item) => item.id === dossier.newsId);
        return {
          id: dossier.productionId,
          title: dossier.outline?.headline.trim() || news?.title || 'Produção sem título',
          stage: STAGE_LABELS[dossier.stage],
          person: news?.decidedBy,
          at: dossier.writtenAt ?? dossier.searchedAt ?? news?.decidedAt,
        };
      })
      .sort((a, b) => (b.at ?? '').localeCompare(a.at ?? '')),
    [state.dossiers, state.news],
  );
}

/**
 * "Usar em artigo" (F2.9): the photo large with the credit and license it carries, the production
 * it goes to (a list to scan, not a cut-off menu), where it goes and its caption. "Usar imagem" waits,
 * with the reason in view, until a production is chosen.
 */
export function UseInArticleDrawer({ photo, open, onClose, onUse }: {
  photo: Photo;
  open: boolean;
  onClose: () => void;
  onUse: (use: ArticleUse) => void;
}) {
  const productions = useProductions();
  const reasonId = useId();
  const [chosen, setChosen] = useState<string>();
  const [query, setQuery] = useState('');
  const [placement, setPlacement] = useState<Placement>('cover');
  const [caption, setCaption] = useState(photo.title);
  const selected = productions.find((item) => item.id === chosen);
  const wanted = normalize(query);
  const shown = wanted ? productions.filter((item) => normalize(item.title).includes(wanted)) : productions;
  const credit = photo.credit.trim();

  function confirm() {
    if (!selected) return;
    onUse({ productionId: selected.id, title: selected.title, placement, caption: caption.trim() || photo.title });
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      dismissible={!chosen && caption === photo.title}
      size="lg"
      title="Usar em artigo"
      footerStart={selected ? undefined : <TruncatedText id={reasonId} text="Escolha a matéria." />}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button
            variant="primary"
            icon={Newspaper}
            aria-disabled={selected ? undefined : true}
            aria-describedby={selected ? undefined : reasonId}
            onClick={confirm}
          >
            Usar imagem
          </Button>
        </>
      )}
    >
      <PageStack>
        <MediaFrame src={photo.preview} alt={photo.title} ratio={`${photo.width}/${photo.height}`} fit="contain" maxHeight={300} radius="md" />
        <DescriptionList
          labelWidth={96}
          items={[
            { label: 'Crédito', value: credit || undefined, leading: <BrandMark name={markName(photo)} size="xs" variant="soft" decorative />, state: credit ? undefined : 'missing' },
            { label: 'Licença', value: licenseLabel(photo) },
          ]}
        />
        <FieldGroup label="Em qual matéria" meta={productions.length > 0 ? plural(productions.length, 'em andamento', 'em andamento') : undefined}>
          {productions.length > SEARCH_FROM ? (
            <SearchField size="sm" label="Buscar matéria" placeholder="Título da matéria" value={query} onValueChange={setQuery} />
          ) : null}
          <List label="Produções em andamento" empty={wanted ? 'Nenhuma matéria com esse título' : 'Nenhuma produção em andamento'}>
            {shown.map((item) => (
              <ListItem
                key={item.id}
                leading={item.person ? <Avatar name={item.person} size="sm" /> : undefined}
                title={item.title}
                titleLines={2}
                description={item.person ? `${item.stage} · ${item.person}` : item.stage}
                meta={item.at ? formatRelative(item.at) : undefined}
                selected={item.id === chosen}
                onClick={() => setChosen(item.id)}
              />
            ))}
          </List>
        </FieldGroup>
        <FieldGroup label="Usar como">
          <Segmented<Placement>
            label="Usar como"
            value={placement}
            onChange={setPlacement}
            options={[{ value: 'cover', label: PLACEMENT_LABELS.cover }, { value: 'body', label: PLACEMENT_LABELS.body }]}
          />
        </FieldGroup>
        <Field label="Legenda">
          {({ id, describedBy }) => (
            <Textarea id={id} aria-describedby={describedBy} rows={2} autoSize value={caption} onChange={(event) => setCaption(event.target.value)} />
          )}
        </Field>
      </PageStack>
    </Drawer>
  );
}
