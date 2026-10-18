'use client';

import { useMemo, useState } from 'react';
import {
  ActionBar,
  Badge,
  BrandMark,
  Button,
  ButtonLink,
  Card,
  CardHeader,
  Delta,
  Field,
  Grid,
  IconButton,
  IconTile,
  Input,
  List,
  ListItem,
  Menu,
  MetricStrip,
  PageHeader,
  PageStack,
  Panel,
  Section,
  Select,
  TagInput,
  Textarea,
  toast,
  formatRelative,
} from '@content-ventures/design-system/v3';
import type { MetricProps, Tone } from '@content-ventures/design-system/v3';
import { CircleDashed, Ellipsis, History, Newspaper, Plus, Tags, Target, Trash2 } from '@content-ventures/design-system/v3/icons';
import type { LucideIcon } from '@content-ventures/design-system/v3/icons';
import { PRIORITY_LABELS, TOPIC_WEIGHT_LABELS } from '@/domain/hard-news';
import type { EditorialMap, EditorialTopic, TopicWeight } from '@/domain/hard-news';
import { useCan } from '@/state';
import { PriorityBadge } from '../news/priority-badge';
import { NEWS_HREF } from '../routes';
import { useHardNews } from '../state/hard-news-provider';
import { useEditGuard } from './edit-guard';
import { changed, exclusionRows, mapChanges, mapCounts, mapRows, ruleEffect, sourceRows, topicRows } from './map-effect';
import type { MapCounts, MapRow } from './map-effect';
import { VersionsDrawer } from './versions-drawer';

const WEIGHT_ICON: Record<TopicWeight, LucideIcon> = { core: Target, regular: Tags, occasional: CircleDashed };
const WEIGHT_TONE: Record<TopicWeight, Tone> = { core: 'blue', regular: 'teal', occasional: 'gray' };
/** What each weight does to a story in the radar, in plain words. */
const WEIGHT_EFFECT: Record<TopicWeight, string> = { core: 'Sobem na fila', regular: 'Entram na fila', occasional: 'Descem na fila' };
const WEIGHTS: readonly TopicWeight[] = ['core', 'regular', 'occasional'];
/** A topic added from the field starts as covered; its menu moves it. */
const NEW_TOPIC_WEIGHT: TopicWeight = 'regular';

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const TO_THE_END = 'Vão para o fim da fila';
const NEXT_STORIES = 'Vale para as próximas notícias';
const SAVE_DETAIL_ID = 'map-save-detail';

/**
 * Mapa editorial (F2.3, REQ-2.3): what the AI considers news for the portal. The page is the map in
 * force, edited in place, each part asked as the desk would ask it: what the portal writes about
 * (topics by weight, each with the stories it holds in the radar now), what stays out, which
 * sources to trust, who it writes for. The strip is the radar under the map on screen; any change
 * shows what moves in the radar and brings the bar that saves a new version.
 */
export function EditorialMapScreen() {
  const { state, ready, actions } = useHardNews();
  const canEdit = useCan('pipeline.edit');
  const saved = state.map;
  const [draft, setDraft] = useState<EditorialMap>(saved);
  const [newTopic, setNewTopic] = useState('');
  const [versionsOpen, setVersionsOpen] = useState(false);
  const changes = useMemo(() => mapChanges(saved, draft), [draft, saved]);
  const dirty = changes.length > 0;
  // A version saved elsewhere (another tab) replaces the draft only when nothing is being changed.
  const [seenVersion, setSeenVersion] = useState(saved.version);
  if (seenVersion !== saved.version) {
    setSeenVersion(saved.version);
    if (!dirty) setDraft(saved);
  }
  const guard = useEditGuard(dirty);
  const patch = (next: Partial<EditorialMap>) => setDraft((current) => ({ ...current, ...next }));
  const onlyAudience = dirty && changes.every((change) => change === 'Público revisto' || change === 'Regiões revistas');

  const rows = useMemo(() => mapRows(state.news, saved, draft), [draft, saved, state.news]);
  const moved = useMemo(() => rows.filter(changed), [rows]);
  const exclusionHits = draft.exclusions.flatMap((term) => exclusionRows(rows, draft, term).map((row) => ({ row, rule: term })));
  const before = mapCounts(rows, 'before');
  const after = mapCounts(rows, 'after');
  const feeds = state.feeds.map((feed) => feed.name).filter((name) => ![...draft.trusted, ...draft.blocked].some((taken) => fold(taken) === fold(name)));

  function addTopic() {
    const label = newTopic.trim();
    if (!label || draft.topics.some((topic) => fold(topic.label) === fold(label))) return;
    patch({ topics: [...draft.topics, { id: `t-${fold(label).replace(/\s+/g, '-')}`, label, weight: NEW_TOPIC_WEIGHT }] });
    setNewTopic('');
  }

  function save() {
    if (!dirty) return;
    actions.saveMap(draft, changes);
    toast(`Mapa editorial v${saved.version + 1} salvo`, { description: 'O radar já usa esta versão.' });
  }

  return (
    <PageStack>
      <PageHeader
        title="Mapa editorial"
        meta={ready ? [`Versão ${saved.version}`, `${saved.updatedBy} · ${formatRelative(new Date(saved.updatedAt))}`] : undefined}
        actions={(
          <>
            <ButtonLink href={NEWS_HREF} variant="ghost" icon={Newspaper}>Ver no radar</ButtonLink>
            <Button variant="secondary" icon={History} disabled={!ready} onClick={() => setVersionsOpen(true)}>Versões</Button>
          </>
        )}
      />
      {guard}
      <MetricStrip label="O radar com este mapa" items={strip(before, after, dirty, ready)} />
      <Panel label="Temas">
        <Section id="mapa-temas" title="Sobre o que o portal escreve?" meta={plural(draft.topics.length, 'tema', 'temas')}>
          <PageStack>
            <Grid columns="1:1:1" collapseBelow={1024} align="start">
              {WEIGHTS.map((weight) => (
                <WeightCard
                  key={weight}
                  weight={weight}
                  topics={draft.topics.filter((topic) => topic.weight === weight)}
                  rows={rows}
                  canEdit={canEdit}
                  onMove={(topic, next) => patch({ topics: draft.topics.map((item) => (item.id === topic.id ? { ...item, weight: next } : item)) })}
                  onRemove={(topic) => patch({ topics: draft.topics.filter((item) => item.id !== topic.id) })}
                />
              ))}
            </Grid>
            {canEdit ? (
              <Field label="Novo tema" hint={`Entra em ${TOPIC_WEIGHT_LABELS[NEW_TOPIC_WEIGHT]}`}>
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    value={newTopic}
                    placeholder="Ex.: Logística"
                    onChange={(event) => setNewTopic(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter') addTopic(); }}
                    trailing={<Button variant="ghost" size="sm" icon={Plus} disabled={!newTopic.trim()} onClick={addTopic}>Adicionar</Button>}
                  />
                )}
              </Field>
            ) : null}
          </PageStack>
        </Section>
      </Panel>
      <Panel label="Fora do mapa">
        <Section title="O que fica de fora?" meta={TO_THE_END}>
          <PageStack>
            <Field label="Assuntos">
              {({ id, describedBy }) => (
                <TagInput id={id} describedBy={describedBy} disabled={!canEdit} values={draft.exclusions} onChange={(exclusions) => patch({ exclusions })} />
              )}
            </Field>
            <Field label="Fontes bloqueadas">
              {({ id, describedBy }) => (
                <TagInput id={id} describedBy={describedBy} disabled={!canEdit} values={draft.blocked} suggestions={feeds} onChange={(blocked) => patch({ blocked })} />
              )}
            </Field>
            {exclusionHits.length ? <RuleHits label={`${plural(after.out, 'notícia fora', 'notícias fora')} agora`} hits={exclusionHits} /> : null}
          </PageStack>
        </Section>
      </Panel>
      <Panel label="Fontes confiáveis">
        <Section title="Em quais fontes confiar?" meta="Sobem na fila">
          <PageStack>
            <List label="Fontes confiáveis" framed={false} bleed empty="Nenhuma fonte confiável.">
              {draft.trusted.map((name) => {
                const queued = sourceRows(rows, name).length;
                return (
                  <ListItem
                    key={name}
                    leading={<BrandMark name={name} size="sm" decorative />}
                    title={name}
                    description={queued ? plural(queued, 'notícia na fila', 'notícias na fila') : 'Nada na fila'}
                    actions={canEdit ? <IconButton label={`Deixar de confiar em ${name}`} icon={Trash2} variant="ghost" size="sm" onClick={() => patch({ trusted: draft.trusted.filter((item) => item !== name) })} /> : undefined}
                  />
                );
              })}
            </List>
            {canEdit && feeds.length > 0 ? (
              <Select
                label="Adicionar fonte confiável"
                placeholder="Adicionar fonte confiável"
                value=""
                options={feeds.map((name) => ({ value: name, label: name }))}
                onChange={(name) => patch({ trusted: [...draft.trusted, name] })}
              />
            ) : null}
          </PageStack>
        </Section>
      </Panel>
      <Panel label="Público">
        <Section title="Para quem o portal escreve?" meta={NEXT_STORIES}>
          <Field label="Público">
            {({ id, describedBy }) => (
              <Textarea id={id} aria-describedby={describedBy} rows={2} autoSize disabled={!canEdit} value={draft.audience} onChange={(event) => patch({ audience: event.target.value })} />
            )}
          </Field>
          <Field label="Regiões">
            {({ id, describedBy }) => (
              <TagInput id={id} describedBy={describedBy} disabled={!canEdit} values={draft.regions} onChange={(regions) => patch({ regions })} />
            )}
          </Field>
        </Section>
      </Panel>
      {dirty && moved.length > 0 ? <Changes rows={moved} /> : null}
      {dirty ? (
        <ActionBar
          position="sticky"
          status="unsaved"
          statusLabel="Alterações não salvas"
          detail={moved.length ? plural(moved.length, 'notícia muda no radar', 'notícias mudam no radar') : onlyAudience ? NEXT_STORIES : 'Nada muda no radar'}
          detailId={SAVE_DETAIL_ID}
        >
          <Button variant="ghost" onClick={() => setDraft(saved)}>Descartar</Button>
          <Button variant="primary" onClick={save}>{`Salvar versão ${saved.version + 1}`}</Button>
        </ActionBar>
      ) : null}
      <VersionsDrawer open={versionsOpen} onClose={() => setVersionsOpen(false)} title="Versões do mapa editorial" entries={state.mapHistory ?? []} />
    </PageStack>
  );
}

/** One weight of the map: its topics, each with the stories it holds in the radar and a menu. */
function WeightCard({ weight, topics, rows, canEdit, onMove, onRemove }: {
  weight: TopicWeight;
  topics: readonly EditorialTopic[];
  rows: readonly MapRow[];
  canEdit: boolean;
  onMove: (topic: EditorialTopic, weight: TopicWeight) => void;
  onRemove: (topic: EditorialTopic) => void;
}) {
  const label = TOPIC_WEIGHT_LABELS[weight];
  return (
    <Card padding="md" as="div">
      <Grid columns="auto" min={10000} gap="md">
        <CardHeader
          titleAs="h3"
          leading={<IconTile icon={WEIGHT_ICON[weight]} tone={WEIGHT_TONE[weight]} variant={weight === 'occasional' ? 'dashed' : 'soft'} size="sm" />}
          title={label}
          description={WEIGHT_EFFECT[weight]}
          meta={String(topics.length)}
        />
        <List label={`Temas: ${label}`} framed={false} bleed empty="Nenhum tema">
          {topics.map((topic) => (
            <ListItem
              key={topic.id}
              density="sm"
              title={topic.label}
              description={ruleEffect(topicRows(rows, topic.label)).line}
              actions={canEdit ? (
                <Menu
                  label={`Mudar ${topic.label}`}
                  align="end"
                  sections={[
                    { label: 'Mover para', items: WEIGHTS.filter((other) => other !== weight).map((other) => ({ label: TOPIC_WEIGHT_LABELS[other], onSelect: () => onMove(topic, other) })) },
                    { items: [{ label: 'Remover tema', icon: Trash2, danger: true, onSelect: () => onRemove(topic) }] },
                  ]}
                  trigger={(props) => <IconButton {...props} label={`Mudar ${topic.label}`} icon={Ellipsis} variant="ghost" size="sm" />}
                />
              ) : undefined}
            />
          ))}
        </List>
      </Grid>
    </Card>
  );
}

/** The radar's queue grouped as the desk sees it, with the change against the saved map. */
function strip(before: MapCounts, after: MapCounts, dirty: boolean, ready: boolean): MetricProps[] {
  const cell = (label: string, key: keyof MapCounts, upIsGood: boolean): MetricProps => {
    const diff = after[key] - before[key];
    return {
      label,
      value: ready ? after[key] : undefined,
      loading: !ready,
      hint: dirty && diff ? `antes ${before[key]}` : key === 'out' ? 'no fim da fila' : 'na fila agora',
      delta: dirty && diff ? { value: `${diff > 0 ? '+' : ''}${diff}`, trend: diff > 0 ? 'up' : 'down', tone: (diff > 0) === upIsGood ? 'good' : 'flat', label: `de ${before[key]} para ${after[key]}` } : undefined,
    };
  };
  return [
    cell(`Prioridade ${PRIORITY_LABELS.high.toLowerCase()}`, 'high', true),
    cell(`Prioridade ${PRIORITY_LABELS.medium.toLowerCase()}`, 'medium', true),
    cell(`Prioridade ${PRIORITY_LABELS.low.toLowerCase()}`, 'low', false),
    cell('Fora do mapa', 'out', false),
  ];
}

/** Stories a rule catches right now, with the rule that caught them. */
function RuleHits({ label, hits }: { label: string; hits: { row: MapRow; rule: string }[] }) {
  return (
    <List label={label} framed={false} bleed>
      {hits.map(({ row, rule }) => (
        <ListItem
          key={`${rule}-${row.item.id}`}
          density="sm"
          leading={<BrandMark name={row.item.source} size="xs" variant="soft" decorative />}
          title={row.item.title}
          description={`${row.item.source} · por “${rule}”`}
          meta={<Badge variant="text" tone="gray" dot="hollow">Fora do mapa</Badge>}
        />
      ))}
    </List>
  );
}

/**
 * While changing: every waiting story whose priority changes, or that enters or leaves the map. It
 * sits at the end, by the save bar, so nothing above the rule being changed moves.
 */
function Changes({ rows }: { rows: readonly MapRow[] }) {
  return (
    <Panel label="O que muda no radar">
      <Section title="O que muda no radar" meta={plural(rows.length, 'notícia', 'notícias')}>
        <List label="Notícias que mudam no radar" framed={false} bleed>
          {rows.map((row) => (
            <ListItem
              key={row.item.id}
              leading={<BrandMark name={row.item.source} size="sm" decorative />}
              title={row.item.title}
              titleLines={2}
              description={row.outAfter !== row.outBefore
                ? (row.outAfter ? 'Sai do mapa' : 'Volta ao mapa')
                : <Delta variant="text" value={`${row.before} → ${row.after}`} trend={row.after > row.before ? 'up' : 'down'} tone="flat" label={`Nota de ${row.before} para ${row.after}`} />}
              meta={row.outAfter
                ? <Badge variant="text" tone="gray" dot="hollow">Fora do mapa</Badge>
                : <PriorityBadge priority={row.priorityAfter} size="sm" />}
            />
          ))}
        </List>
      </Section>
    </Panel>
  );
}
