'use client';

import { useMemo, useState } from 'react';
import {
  ActionBar,
  Alert,
  Button,
  DescriptionList,
  Dialog,
  DiffView,
  ErrorState,
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
import { ArrowRight, History, Plus, Trash2 } from '@content-ventures/design-system/v3/icons';
import type { WritingGuide } from '@/domain/hard-news';
import { applyWritingGuideSuggestions, writingGuideSuggestions } from '@/domain/writing-guide-suggestions';
import { useCan } from '@/state';
import { usePhone } from '@/ui/use-phone';
import { useEditGuard } from './edit-guard';
import { applyGuide, guideChanges, openingChecks, SAMPLE_DRAFT, termWord, wordDiff } from './guide-effect';
import type { GuideChange } from './guide-effect';
import { VersionsDrawer } from './versions-drawer';
import { validReferenceUrl } from './editorial-settings';
import { useEditorialSettings, type EditorialSettings } from './use-editorial-settings';

type PrincipleKey = 'voice' | 'headline' | 'dek' | 'lead' | 'attribution';

const PRINCIPLES: { key: PrincipleKey; label: string; check?: string; subject?: string }[] = [
  { key: 'voice', label: 'Voz' },
  { key: 'headline', label: 'Título', check: 'Título', subject: 'O título de exemplo' },
  { key: 'dek', label: 'Linha fina' },
  { key: 'lead', label: 'Lead', check: 'Lead', subject: 'O lead de exemplo' },
  { key: 'attribution', label: 'Atribuição', check: 'Atribuição', subject: 'O lead de exemplo' },
];
const COMPOSITION: { key: keyof NonNullable<WritingGuide['composition']>; label: string }[] = [
  { key: 'paragraphs', label: 'Parágrafos' }, { key: 'headings', label: 'Intertítulos' },
  { key: 'emphasis', label: 'Negrito e destaques' }, { key: 'lists', label: 'Listas' },
  { key: 'closing', label: 'Encerramento' }, { key: 'length', label: 'Extensão' },
  { key: 'links', label: 'Links' }, { key: 'figures', label: 'Imagens e legendas' },
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
  const settings = useEditorialSettings();
  if (!settings.ready) return settings.error
    ? <ErrorState heading="h1" title="Não foi possível abrir o guia" description={settings.error} onRetry={() => void settings.reload()} size="page" />
    : <PageStack><PageHeader title="Guia de escrita" /><Panel><Section title="Carregando guia"><DescriptionList items={[]} loading /></Section></Panel></PageStack>;
  return <WritingGuideForm key={settings.editorKey} settings={settings} />;
}

function WritingGuideForm({ settings }: { settings: EditorialSettings }) {
  const { guide: saved, demo, saving, conflict } = settings;
  const permission = useCan('pipeline.edit');
  const canEdit = permission && !saving;
  const phone = usePhone();
  const [draft, setDraft] = useState<WritingGuide>(saved);
  const [baseVersion, setBaseVersion] = useState(saved);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const changes = useMemo(() => guideChanges(baseVersion, draft), [draft, baseVersion]);
  const dirty = changes.length > 0;
  if (baseVersion.version !== saved.version && !dirty) {
    setBaseVersion(saved);
    setDraft(saved);
  }
  const guard = useEditGuard(dirty || saving);
  const patch = (next: Partial<WritingGuide>) => setDraft((current) => ({ ...current, ...next }));
  const applied = useMemo(() => applyGuide(SAMPLE_DRAFT, draft), [draft]);
  const base = useMemo(() => applyGuide(SAMPLE_DRAFT, saved), [saved]);
  const exampleMoved = applied.after !== base.after;
  const checks = useMemo(() => openingChecks(draft), [draft]);
  const invalidExamples = draft.examples.some(example => !example.title.trim() || !validReferenceUrl(example.url));
  const suggestions = useMemo(() => writingGuideSuggestions(draft), [draft]);

  async function save() {
    if (!dirty || !canEdit || invalidExamples) return;
    const version = await settings.saveGuide(draft, changes);
    if (version !== undefined) toast(`Guia de escrita v${version} salvo`, { description: demo ? 'Salvo neste navegador · simulação local' : NEXT_ARTICLES });
  }

  return (
    <PageStack>
      <PageHeader
        title="Guia de escrita"
        meta={[demo ? 'Simulação local' : saved.version ? `Versão ${saved.version}` : 'Ainda não configurado', ...(saved.version ? [`${saved.updatedBy} · ${formatRelative(new Date(saved.updatedAt))}`] : [])]}
        actions={<Button variant="secondary" icon={History} onClick={() => setVersionsOpen(true)}>Versões</Button>}
      />
      {guard}
      {settings.error && <Alert tone="danger" title={settings.error} action={conflict ? <Button variant="ghost" disabled={saving} onClick={() => void settings.reload()}>Descartar e carregar versão atual</Button> : undefined} />}
      {demo && <Panel label="Simulação do guia">
        <Section title="Simulação do guia" meta={plural(applied.changes.length, 'mudança no exemplo', 'mudanças no exemplo')}>
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
      </Panel>}
      <Panel label="Como a IA escreve">
        <Section id="guia-principios" title="Como a IA escreve?" meta={NEXT_ARTICLES}
          action={permission ? <Button variant="ghost" disabled={!canEdit || conflict || !suggestions.length} onClick={() => setSuggestionsOpen(true)}>Revisar sugestões</Button> : undefined}>
          <Grid columns="1:1" collapseBelow={760} align="start">
            {PRINCIPLES.map((principle) => {
              const check = demo ? checks.find((entry) => entry.rule === principle.check) : undefined;
              return (
                <Field key={principle.key} label={principle.label} error={check && !check.ok ? `${principle.subject} fica fora: ${check.detail}` : undefined}>
                  {({ id, describedBy, invalid }) => (
                    <Textarea id={id} aria-describedby={describedBy} invalid={invalid} rows={3} autoSize maxLength={4000} disabled={!canEdit} value={draft[principle.key] ?? ''} onChange={(event) => patch({ [principle.key]: event.target.value })} />
                  )}
                </Field>
              );
            })}
          </Grid>
        </Section>
      </Panel>
      <Panel label="Estrutura e formatação">
        <Section title="Estrutura e formatação">
          <Grid columns="1:1" collapseBelow={760} align="start">
            {COMPOSITION.map(({ key, label }) => <Field key={key} label={label}>
              {({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} rows={3} autoSize maxLength={4000} disabled={!canEdit}
                value={draft.composition?.[key] ?? ''} onChange={event => patch({ composition: { ...draft.composition, [key]: event.target.value } })} />}
            </Field>)}
          </Grid>
        </Section>
      </Panel>
      <Terms guide={draft} changes={demo ? applied.changes : []} canEdit={canEdit} onChange={(terms) => patch({ terms })} />
      <Rules guide={draft} changes={demo ? applied.changes : []} canEdit={canEdit} onChange={(rules) => patch({ rules })} />
      <Examples guide={draft} canEdit={canEdit} onChange={examples => patch({ examples })} />
      <Dialog open={suggestionsOpen} onClose={() => setSuggestionsOpen(false)} title="Sugestões para o guia" size="lg"
        description="Compare os campos que serão substituídos no rascunho. Depois, você pode editar e salvar uma nova versão."
        footer={<><Button variant="ghost" onClick={() => setSuggestionsOpen(false)}>Cancelar</Button>
          <Button variant="primary" disabled={!canEdit || conflict || !suggestions.length} onClick={() => { setDraft(applyWritingGuideSuggestions(draft)); setSuggestionsOpen(false); }}>Aplicar ao rascunho</Button></>}>
        <PageStack>{suggestions.map(change => <Panel key={change.id}><Section title={change.label} titleAs="h3">
          <DiffView label={`Sugestão de ${change.label}`} mode={phone ? 'inline' : 'split'} size="compact" summary={false}
            before={{ label: 'No rascunho' }} after={{ label: 'Sugestão' }}
            blocks={[{ id: change.id, change: 'modified', hunks: wordDiff(change.before, change.after) }]} />
        </Section></Panel>)}</PageStack>
      </Dialog>
      {dirty ? (
        <ActionBar
          position="sticky"
          status="unsaved"
          statusLabel={saving ? 'Salvando…' : 'Alterações não salvas'}
          detail={demo && exampleMoved ? 'O exemplo mudou' : NEXT_ARTICLES}
          detailId={SAVE_DETAIL_ID}
        >
          <Button variant="ghost" disabled={saving} onClick={() => { setBaseVersion(saved); setDraft(saved); }}>Descartar</Button>
          <Button variant="primary" disabled={!canEdit || conflict || invalidExamples} onClick={() => void save()}>{saving ? 'Salvando…' : `Salvar versão ${saved.version + 1}`}</Button>
        </ActionBar>
      ) : null}
      <VersionsDrawer
        open={versionsOpen}
        onClose={() => setVersionsOpen(false)}
        title="Versões do guia de escrita"
        entries={settings.guideHistory}
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
      <Section title="Vocabulário preferido" meta={String(guide.terms.length)}>
        <PageStack>
          <List label="Preferências de vocabulário" framed={false} bleed empty="Nenhuma palavra no guia.">
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
                {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} maxLength={300} value={avoid} placeholder="Ex.: impactar" onChange={(event) => setAvoid(event.target.value)} />}
              </Field>
              <Field label="Usar" hint="Na prosa, preservando as citações literais.">
                {({ id, describedBy }) => (
                  <Input id={id} aria-describedby={describedBy} maxLength={300} value={use} placeholder="Ex.: afetar"
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
                <Input id={id} aria-describedby={describedBy} maxLength={1000} value={rule} placeholder='Ex.: Nada de "confira"'
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

function Examples({ guide, canEdit, onChange }: { guide: WritingGuide; canEdit: boolean; onChange: (examples: WritingGuide['examples']) => void }) {
  const patch = (id: string, next: Partial<WritingGuide['examples'][number]>) => onChange(guide.examples.map(example => example.id === id ? { ...example, ...next } : example));
  return <Panel label="Referências editoriais">
    <Section title="Referências editoriais">
      {canEdit && <Button variant="secondary" icon={Plus} onClick={() => onChange([...guide.examples, { id: `ex-${crypto.randomUUID()}`, title: '', url: '', note: '' }])}>Adicionar referência</Button>}
        {guide.examples.map((example, index) => <Section key={example.id} title={`Referência ${index + 1}`} titleAs="h3"
          action={canEdit ? <IconButton label={`Remover referência ${index + 1}`} icon={Trash2} variant="ghost" onClick={() => onChange(guide.examples.filter(item => item.id !== example.id))} /> : undefined}>
          <Grid columns="1:1" collapseBelow={760} align="start">
            <Field label={`Título da referência ${index + 1}`}>
              {({ id, describedBy }) => <Input id={id} aria-describedby={describedBy} maxLength={300} disabled={!canEdit} value={example.title} onChange={event => patch(example.id, { title: event.target.value })} />}
            </Field>
            <Field label={`URL da referência ${index + 1}`} hint="O link não importa o texto automaticamente." error={example.url && !validReferenceUrl(example.url) ? 'Use um endereço http ou https.' : undefined}>
              {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} invalid={invalid} type="url" maxLength={2000} disabled={!canEdit} value={example.url} onChange={event => patch(example.id, { url: event.target.value })} />}
            </Field>
          </Grid>
          <Field label={`Observação editorial ${index + 1}`}>
            {({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} rows={2} autoSize maxLength={2000} disabled={!canEdit} value={example.note} onChange={event => patch(example.id, { note: event.target.value })} />}
          </Field>
        </Section>)}
    </Section>
  </Panel>;
}
