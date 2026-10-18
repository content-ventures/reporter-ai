'use client';

import { useMemo, useState } from 'react';
import {
  ActionBar,
  Button,
  DiffView,
  Field,
  Grid,
  IconButton,
  Input,
  List,
  ListItem,
  PageHeader,
  PageStack,
  Panel,
  Section,
  Textarea,
  toast,
  formatRelative,
} from '@content-ventures/design-system/v3';
import { ArrowRight, Check, History, Plus, Trash2 } from '@content-ventures/design-system/v3/icons';
import type { WritingGuide } from '@/domain/hard-news';
import { useCan } from '@/state';
import { usePhone } from '@/ui/use-phone';
import { useHardNews } from '../state/hard-news-provider';
import { useEditGuard } from './edit-guard';
import { applyGuide, guideChanges, openingChecks, SAMPLE_DRAFT, termWord, wordDiff } from './guide-effect';
import type { GuideChange } from './guide-effect';
import { VersionsDrawer } from './versions-drawer';

type PrincipleKey = 'voice' | 'headline' | 'lead' | 'attribution';

const PRINCIPLES: { key: PrincipleKey; label: string; check?: string; subject?: string }[] = [
  { key: 'voice', label: 'Voz' },
  { key: 'headline', label: 'Título', check: 'Título', subject: 'O título de exemplo' },
  { key: 'lead', label: 'Lead', check: 'Lead', subject: 'O lead de exemplo' },
  { key: 'attribution', label: 'Atribuição', check: 'Atribuição', subject: 'O lead de exemplo' },
];

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const NEXT_ARTICLES = 'Vale para os próximos artigos';
const SAVE_DETAIL_ID = 'guide-save-detail';

/**
 * Guia de escrita (F2.5, REQ-2.5): how the AI writes the portal's articles. The page is the guide
 * in force, edited in place: first a paragraph before and after the guide (the guide at work, live
 * while it changes), then each part asked as the desk would ask it: how the AI writes, which words
 * it swaps, which rules it follows, which articles are the model. Any change brings the bar that
 * saves a new version; the versions, with the articles each one wrote, are in a drawer.
 */
export function WritingGuideScreen() {
  const { state, ready, actions } = useHardNews();
  const canEdit = useCan('pipeline.edit');
  const phone = usePhone();
  const saved = state.guide;
  const [draft, setDraft] = useState<WritingGuide>(saved);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const changes = useMemo(() => guideChanges(saved, draft), [draft, saved]);
  const dirty = changes.length > 0;
  // A version saved elsewhere (another tab) replaces the draft only when nothing is being changed.
  const [seenVersion, setSeenVersion] = useState(saved.version);
  if (seenVersion !== saved.version) {
    setSeenVersion(saved.version);
    if (!dirty) setDraft(saved);
  }
  const guard = useEditGuard(dirty);
  const patch = (next: Partial<WritingGuide>) => setDraft((current) => ({ ...current, ...next }));
  const applied = useMemo(() => applyGuide(SAMPLE_DRAFT, draft), [draft]);
  const base = useMemo(() => applyGuide(SAMPLE_DRAFT, saved), [saved]);
  const exampleMoved = applied.after !== base.after;
  const checks = useMemo(() => openingChecks(draft), [draft]);
  const written = useMemo(() => Object.values(state.dossiers).filter((dossier) => dossier.guideVersion !== undefined), [state.dossiers]);

  function save() {
    if (!dirty) return;
    actions.saveGuide(draft, changes);
    toast(`Guia de escrita v${saved.version + 1} salvo`, { description: NEXT_ARTICLES });
  }

  return (
    <PageStack>
      <PageHeader
        title="Guia de escrita"
        meta={ready ? [`Versão ${saved.version}`, `${saved.updatedBy} · ${formatRelative(new Date(saved.updatedAt))}`] : undefined}
        actions={<Button variant="secondary" icon={History} disabled={!ready} onClick={() => setVersionsOpen(true)}>Versões</Button>}
      />
      {guard}
      <Panel label="O guia em ação">
        <Section title="O guia em ação" meta={plural(applied.changes.length, 'mudança no exemplo', 'mudanças no exemplo')}>
          <DiffView
            label="Um parágrafo antes e depois do guia"
            mode={phone ? 'inline' : 'split'}
            summary={false}
            size="compact"
            before={{ label: 'Sem o guia' }}
            after={{ label: dirty ? 'Com as mudanças' : `Com o guia v${saved.version}` }}
            blocks={[{ id: 'sample', change: applied.changes.length ? 'modified' : 'unchanged', hunks: wordDiff(SAMPLE_DRAFT, applied.after) }]}
          />
        </Section>
      </Panel>
      <Panel label="Como a IA escreve">
        <Section id="guia-principios" title="Como a IA escreve?" meta={NEXT_ARTICLES}>
          <Grid columns="1:1" collapseBelow={760} align="start">
            {PRINCIPLES.map((principle) => {
              const check = checks.find((entry) => entry.rule === principle.check);
              return (
                <Field key={principle.key} label={principle.label} error={check && !check.ok ? `${principle.subject} fica fora: ${check.detail}` : undefined}>
                  {({ id, describedBy, invalid }) => (
                    <Textarea id={id} aria-describedby={describedBy} invalid={invalid} rows={2} autoSize disabled={!canEdit} value={draft[principle.key]} onChange={(event) => patch({ [principle.key]: event.target.value })} />
                  )}
                </Field>
              );
            })}
          </Grid>
        </Section>
      </Panel>
      <Terms guide={draft} changes={applied.changes} canEdit={canEdit} onChange={(terms) => patch({ terms })} />
      <Rules guide={draft} changes={applied.changes} canEdit={canEdit} onChange={(rules) => patch({ rules })} />
      <Panel label="Matérias de modelo">
        <Section title="Quais matérias servem de modelo?" meta={String(draft.examples.length)}>
          <List label="Matérias de modelo" framed={false} bleed>
            {draft.examples.map((example) => (
              <ListItem key={example.id} icon={Check} title={example.title} titleLines={2} description={example.note} href={example.url} />
            ))}
          </List>
        </Section>
      </Panel>
      {dirty ? (
        <ActionBar
          position="sticky"
          status="unsaved"
          statusLabel="Alterações não salvas"
          detail={exampleMoved ? 'O exemplo mudou' : NEXT_ARTICLES}
          detailId={SAVE_DETAIL_ID}
        >
          <Button variant="ghost" onClick={() => setDraft(saved)}>Descartar</Button>
          <Button variant="primary" onClick={save}>{`Salvar versão ${saved.version + 1}`}</Button>
        </ActionBar>
      ) : null}
      <VersionsDrawer
        open={versionsOpen}
        onClose={() => setVersionsOpen(false)}
        title="Versões do guia de escrita"
        entries={state.guideHistory ?? []}
        extra={(entry) => {
          const articles = written.filter((dossier) => dossier.guideVersion === entry.version).length;
          return articles ? `${plural(articles, 'artigo escrito', 'artigos escritos')} com esta versão` : undefined;
        }}
      />
    </PageStack>
  );
}

/** Preferred terms: what the AI writes, instead of what; the ones that touched the example say so. */
function Terms({ guide, changes, canEdit, onChange }: { guide: WritingGuide; changes: readonly GuideChange[]; canEdit: boolean; onChange: (terms: WritingGuide['terms']) => void }) {
  const [avoid, setAvoid] = useState('');
  const [use, setUse] = useState('');
  const known = guide.terms.some((term) => fold(term.avoid) === fold(avoid));
  function add() {
    if (!avoid.trim() || !use.trim() || known) return;
    onChange([...guide.terms, { avoid: avoid.trim(), use: use.trim() }]);
    setAvoid('');
    setUse('');
  }
  return (
    <Panel label="Palavras">
      <Section title="Que palavras a IA troca?" meta={String(guide.terms.length)}>
        <PageStack>
          <List label="Palavras que a IA troca" framed={false} bleed empty="Nenhuma palavra no guia.">
            {guide.terms.map((term) => {
              const used = changes.some((change) => change.kind === 'term' && change.from === term.avoid.trim());
              return (
                <ListItem
                  key={term.avoid}
                  icon={ArrowRight}
                  title={termWord(term.use)}
                  description={`Em vez de “${term.avoid}”${used ? ' · muda o exemplo' : ''}`}
                  actions={canEdit ? <IconButton label={`Remover ${term.avoid}`} icon={Trash2} variant="ghost" size="sm" onClick={() => onChange(guide.terms.filter((item) => item.avoid !== term.avoid))} /> : undefined}
                />
              );
            })}
          </List>
          {canEdit ? (
            <Grid columns="1:1" collapseBelow={640} align="start">
              <Field label="Evitar" error={known ? 'Essa palavra já está no guia' : undefined}>
                {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} value={avoid} placeholder="Ex.: impactar" onChange={(event) => setAvoid(event.target.value)} />}
              </Field>
              <Field label="Usar">
                {({ id, describedBy }) => (
                  <Input id={id} aria-describedby={describedBy} value={use} placeholder="Ex.: afetar"
                    onChange={(event) => setUse(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter') add(); }}
                    trailing={<Button variant="ghost" size="sm" icon={Plus} disabled={!avoid.trim() || !use.trim() || known} onClick={add}>Adicionar</Button>} />
                )}
              </Field>
            </Grid>
          ) : null}
        </PageStack>
      </Section>
    </Panel>
  );
}

/** The house rules, numbered as the example's changes cite them ("Regra 5"). */
function Rules({ guide, changes, canEdit, onChange }: { guide: WritingGuide; changes: readonly GuideChange[]; canEdit: boolean; onChange: (rules: WritingGuide['rules']) => void }) {
  const [rule, setRule] = useState('');
  function add() {
    if (!rule.trim()) return;
    onChange([...guide.rules, { id: `r-${crypto.randomUUID()}`, text: rule.trim() }]);
    setRule('');
  }
  return (
    <Panel label="Regras da casa">
      <Section title="Que regras a IA segue?" meta={String(guide.rules.length)}>
        <PageStack>
          <List label="Regras da casa" framed={false} bleed empty="Nenhuma regra no guia.">
            {guide.rules.map((entry, index) => {
              const used = changes.some((change) => change.rule === `Regra ${index + 1}`);
              return (
                <ListItem
                  key={entry.id}
                  title={entry.text}
                  titleLines={2}
                  description={`Regra ${index + 1}${used ? ' · muda o exemplo' : ''}`}
                  actions={canEdit ? <IconButton label={`Remover regra ${index + 1}`} icon={Trash2} variant="ghost" size="sm" onClick={() => onChange(guide.rules.filter((item) => item.id !== entry.id))} /> : undefined}
                />
              );
            })}
          </List>
          {canEdit ? (
            <Field label="Nova regra">
              {({ id, describedBy }) => (
                <Input id={id} aria-describedby={describedBy} value={rule} placeholder='Ex.: Nada de "confira"'
                  onChange={(event) => setRule(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') add(); }}
                  trailing={<Button variant="ghost" size="sm" icon={Plus} disabled={!rule.trim()} onClick={add}>Adicionar</Button>} />
              )}
            </Field>
          ) : null}
        </PageStack>
      </Section>
    </Panel>
  );
}
