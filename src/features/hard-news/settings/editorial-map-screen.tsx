'use client';

import { useMemo, useState } from 'react';
import {
  ActionBar,
  Alert,
  Badge,
  BrandMark,
  Button,
  ButtonLink,
  Card,
  CardHeader,
  Delta,
  DescriptionList,
  ErrorState,
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
import { changed, exclusionRows, mapChanges, mapCounts, mapRows, ruleEffect, topicRows } from './map-effect';
import type { MapCounts, MapRow } from './map-effect';
import { VersionsDrawer } from './versions-drawer';
import { useEditorialSettings, type EditorialSettings } from './use-editorial-settings';

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
  const settings = useEditorialSettings();
  if (!settings.ready) return settings.error
    ? <ErrorState heading="h1" title="Não foi possível abrir o mapa" description={settings.error} onRetry={() => void settings.reload()} size="page" />
    : <PageStack><PageHeader title="Mapa editorial" /><Panel><Section title="Carregando mapa"><DescriptionList items={[]} loading /></Section></Panel></PageStack>;
  return <EditorialMapForm key={settings.editorKey} settings={settings} />;
}

function EditorialMapForm({ settings }: { settings: EditorialSettings }) {
  const { state } = useHardNews();
  const { map: saved, demo, saving, conflict } = settings;
  const permission = useCan('pipeline.edit');
  const canEdit = permission && !saving;
  const [draft, setDraft] = useState<EditorialMap>(saved);
  const [baseVersion, setBaseVersion] = useState(saved);
  const [newTopic, setNewTopic] = useState('');
  const [versionsOpen, setVersionsOpen] = useState(false);
  const changes = useMemo(() => mapChanges(baseVersion, draft), [draft, baseVersion]);
  const dirty = changes.length > 0;
  if (baseVersion.version !== saved.version && !dirty) {
    setBaseVersion(saved);
    setDraft(saved);
  }
  const guard = useEditGuard(dirty || saving);
  const patch = (next: Partial<EditorialMap>) => setDraft((current) => ({ ...current, ...next }));
  const onlyAudience = dirty && changes.every((change) => change === 'Público revisto' || change === 'Regiões revistas');

  const rows = useMemo(() => demo ? mapRows(state.news, saved, draft) : [], [demo, draft, saved, state.news]);
  const moved = useMemo(() => rows.filter(changed), [rows]);
  const exclusionHits = draft.exclusions.flatMap((term) => exclusionRows(rows, draft, term).map((row) => ({ row, rule: term })));
  const before = mapCounts(rows, 'before');
  const after = mapCounts(rows, 'after');
  const feeds = demo ? state.feeds.map((feed) => feed.name).filter((name) => ![...draft.trusted, ...draft.blocked].some((taken) => fold(taken) === fold(name))) : [];

  function addTopic() {
    const label = newTopic.trim();
    if (!label || draft.topics.some((topic) => fold(topic.label) === fold(label))) return;
    patch({ topics: [...draft.topics, { id: `t-${crypto.randomUUID()}`, label, weight: NEW_TOPIC_WEIGHT }] });
    setNewTopic('');
  }

  async function save() {
    if (!dirty || !canEdit) return;
    const version = await settings.saveMap(draft, changes);
    if (version !== undefined) toast(`Mapa editorial v${version} salvo`, { description: demo ? 'Salvo neste navegador · simulação local' : 'Vale para as próximas gerações.' });
  }

  return (
    <PageStack>
      <PageHeader
        title="Mapa editorial"
        meta={[demo ? 'Simulação local' : saved.version ? `Versão ${saved.version}` : 'Ainda não configurado', ...(saved.version ? [`${saved.updatedBy} · ${formatRelative(new Date(saved.updatedAt))}`] : [])]}
        actions={(
          <>
            {demo && <ButtonLink href={NEWS_HREF} variant="ghost" icon={Newspaper}>Ver no radar</ButtonLink>}
            <Button variant="secondary" icon={History} onClick={() => setVersionsOpen(true)}>Versões</Button>
          </>
        )}
      />
      {guard}
      {settings.error && <Alert tone="danger" title={settings.error} action={conflict ? <Button variant="ghost" disabled={saving} onClick={() => void settings.reload()}>Descartar e carregar versão atual</Button> : undefined} />}
      {demo && <MetricStrip label="O radar com este mapa" items={strip(before, after, dirty, true)} />}
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
                  demo={demo}
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
                    maxLength={300}
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
        <Section title="O que fica de fora?" meta={demo ? TO_THE_END : undefined}>
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
        <Section title="Em quais fontes confiar?">
          <Field label="Fontes de referência" hint="A preferência não substitui a verificação dos fatos.">
            {({ id, describedBy }) => <TagInput id={id} describedBy={describedBy} disabled={!canEdit} values={draft.trusted} suggestions={feeds} onChange={trusted => patch({ trusted })} />}
          </Field>
        </Section>
      </Panel>
      <Panel label="Público">
        <Section title="Para quem o portal escreve?">
          <Field label="Público">
            {({ id, describedBy }) => (
              <Textarea id={id} aria-describedby={describedBy} rows={2} autoSize maxLength={4000} disabled={!canEdit} value={draft.audience} onChange={(event) => patch({ audience: event.target.value })} />
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
          statusLabel={saving ? 'Salvando…' : 'Alterações não salvas'}
          detail={demo ? moved.length ? plural(moved.length, 'notícia muda no radar', 'notícias mudam no radar') : onlyAudience ? NEXT_STORIES : 'Nada muda no radar' : 'Vale para as próximas gerações'}
          detailId={SAVE_DETAIL_ID}
        >
          <Button variant="ghost" disabled={saving} onClick={() => { setBaseVersion(saved); setDraft(saved); }}>Descartar</Button>
          <Button variant="primary" disabled={!canEdit || conflict} onClick={() => void save()}>{saving ? 'Salvando…' : `Salvar versão ${saved.version + 1}`}</Button>
        </ActionBar>
      ) : null}
      <VersionsDrawer open={versionsOpen} onClose={() => setVersionsOpen(false)} title="Versões do mapa editorial" entries={settings.mapHistory} />
    </PageStack>
  );
}

/** One weight of the map: its topics, each with the stories it holds in the radar and a menu. */
function WeightCard({ weight, topics, rows, demo, canEdit, onMove, onRemove }: {
  weight: TopicWeight;
  topics: readonly EditorialTopic[];
  rows: readonly MapRow[];
  demo: boolean;
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
          description={demo ? WEIGHT_EFFECT[weight] : undefined}
          meta={String(topics.length)}
        />
        <List label={`Temas: ${label}`} framed={false} bleed empty="Nenhum tema">
          {topics.map((topic) => (
            <ListItem
              key={topic.id}
              density="sm"
              title={topic.label}
              description={demo ? ruleEffect(topicRows(rows, topic.label)).line : undefined}
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
