'use client';

import { useCallback, useId, useMemo, useState } from 'react';
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
import type { Refusal } from '@/domain/result';
import { createBlockIdFactory } from '@/editor/block-ids';
import type { ProductionListFilter } from '@/ports';
import { useCommands, useProductions as useWorkspaceProductions, useRuntime } from '@/state';
import { plural } from '@/ui/format';
import { notifyRefusal } from '@/ui/permission-dialog';
import { placeImage, PLACEMENT_LABELS } from './article-image';
import type { Placement } from './article-image';
import { licenseLabel, markName, normalize } from './images-model';
import type { Photo } from './images-model';

export type { Placement };
export { PLACEMENT_LABELS };

export type ArticleUse = { productionId: string; title: string; placement: Placement; caption: string };

/** With more productions than this, a search sits above the list. */
const SEARCH_FROM = 6;

const IN_PROGRESS: ProductionListFilter = { sort: 'updated_desc' };
const FIRST_PAGE = { page: 1, size: 50 };

type Production = { id: string; title: string; stage: string; person?: string; at?: string };

/** The workspace's productions in progress (R1), the most recently touched first. */
function useProductions(): Production[] {
  const page = useWorkspaceProductions(IN_PROGRESS, FIRST_PAGE).data;
  return useMemo(
    () => (page?.items ?? [])
      .filter((item) => !item.archived)
      .map((item) => ({ id: item.id, title: item.title, stage: item.situation.line, person: item.owner.name, at: item.updatedAt })),
    [page],
  );
}

const newBlockId = createBlockIdFactory({ prefix: 'img' });

const SAVE_REFUSALS: Partial<Record<string, string>> = {
  locked: 'O artigo está em aprovação. Use a imagem depois da decisão.',
  conflict: 'O artigo mudou agora há pouco. Tente de novo.',
  quota: 'O armazenamento deste navegador está cheio.',
  invalid_url: 'O endereço da imagem não abriu.',
};

function refused(refusal: Pick<Refusal, 'code' | 'message'>) {
  notifyRefusal('Não foi possível usar a imagem', { code: refusal.code, message: SAVE_REFUSALS[refusal.code] ?? refusal.message });
}

const NO_ARTICLE = { code: 'not_found', message: 'Esta produção não tem artigo para receber a imagem.' };

/**
 * "Usar imagem": the photo goes into the chosen production's article, as its cover or as a figure
 * at the end of the text, with its caption and credit (an R1 image asset, saved with the draft).
 * Resolves `false` when it could not, after saying why.
 */
export function usePlaceInArticle(): (photo: Photo, use: ArticleUse) => Promise<boolean> {
  const { runtime } = useRuntime();
  const commands = useCommands();
  return useCallback(async (photo, use) => {
    if (!runtime) return false;
    const found = await runtime.queries.get(use.productionId).catch(() => undefined);
    const piece = found?.ok ? found.value.pieces.find((item) => item.kind === 'article') : undefined;
    const draft = piece ? await runtime.queries.draft(piece.id).catch(() => undefined) : undefined;
    if (!piece || !draft?.ok || draft.value.body.type !== 'article') {
      refused(NO_ARTICLE);
      return false;
    }
    const credit = photo.credit.trim();
    const asset = await commands.assets.put(
      { type: 'url', url: photo.full, width: photo.width, height: photo.height },
      { productionId: use.productionId, authorized: true, ...(credit ? { credit } : {}) },
    );
    if (!asset.ok) {
      refused(asset.refusal);
      return false;
    }
    const body = placeImage(draft.value.body, { assetId: asset.value.id, caption: use.caption, alt: photo.title }, use.placement, newBlockId());
    const saved = await commands.production.saveDraft(piece.id, body, draft.value.revision);
    if (!saved.ok) {
      refused(saved.refusal);
      return false;
    }
    return true;
  }, [runtime, commands]);
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
  onUse: (use: ArticleUse) => void | Promise<void>;
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
