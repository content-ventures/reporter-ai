'use client';
import { useState } from 'react';
import { Button, Checkbox, FormRow, FormSection, Input, Select, Textarea, toast } from '@content-ventures/design-system/v3';
import { coverageFormat, defaultEditorialPlan, EDITORIAL_CATEGORIES, EDITORIAL_FORMATS, type EditorialCategory, type EditorialPlan } from '@/domain/editorial-plan';
import { useCommands } from '@/state';
import { useWorkspaceStorageKey } from '@/state/workspace-storage';
import { draftMaterial, withFormat, type NewProductionDraft } from './form';
export function EditorialSection({ draft, update, compact = false }: { draft: NewProductionDraft; update: (patch: Partial<NewProductionDraft>) => void; compact?: boolean }) {
  const preferenceKey = useWorkspaceStorageKey('reporter:new-production');
  const commands = useCommands();
  const [planning, setPlanning] = useState(false);
  const plan = draft.editorial ?? defaultEditorialPlan();
  const change = (patch: Partial<EditorialPlan>) => {
    const editorial = { ...plan, ...patch };
    update({ editorial, ...(patch.category || patch.formats ? withFormat(coverageFormat(editorial.formats[0])) : {}),
      ...(patch.eventName !== undefined ? { event: { ...draft.event, name: patch.eventName } } : {}) });
  };
  return <FormSection title={compact ? 'Orientações da produção' : 'O que você quer produzir?'} titleAs="h2" state="active" open>
    {!compact && <>
      <FormRow label="Categoria">{({ id, describedBy }) => <Select id={id} describedBy={describedBy} value={plan.category} options={EDITORIAL_CATEGORIES.map(c => ({ value: c.id, label: c.label }))} onChange={category => {
        const format = EDITORIAL_FORMATS.find(f => f.category === category)!;
        change({ category: category as EditorialCategory, formats: [format.id], maxChars: format.chars, fastDraft: format.chars <= 6000 });
      }} />}</FormRow>
      <FormRow label="Formatos" hint="Selecione os formatos para este material. Cada texto terá sua própria produção.">
        {EDITORIAL_FORMATS.filter(f => f.category === plan.category).map(format => <Checkbox key={format.id} label={format.label} checked={plan.formats.includes(format.id)} onChange={event => {
          const formats = event.target.checked ? [...plan.formats, format.id] : plan.formats.filter(id => id !== format.id);
          if (formats.length) change({ formats, ...(formats.length === 1 ? { maxChars: EDITORIAL_FORMATS.find(f => f.id === formats[0])!.chars, fastDraft: EDITORIAL_FORMATS.find(f => f.id === formats[0])!.chars <= 6000 } : {}) });
        }} />)}
      </FormRow>
    </>}
    {compact && <Button loading={planning} disabled={!draftMaterial(draft).text.trim()} onClick={async () => {
      setPlanning(true);
      try {
        const response = await commands.ingest.plan(draftMaterial(draft).text, plan.instructions || 'Mapeie os temas e eventos que podem render pautas independentes, sem quantidade fixa.');
        if (!response.ok) throw new Error(response.refusal.message);
        const result = response.value;
        change({ mainTopic: plan.mainTopic || result.title, secondaryTopics: result.topics });
        toast('Temas sugeridos', { description: 'Edite a seleção antes de gerar. Nenhum artigo foi criado.' });
      } catch (error) { toast('Planejamento não concluído', { tone: 'error', description: error instanceof Error ? error.message : 'Tente novamente.' }); }
      finally { setPlanning(false); }
    }}>Sugerir temas a partir dos materiais</Button>}
    <FormRow label="Tema principal" optional>{({ id }) => <Input id={id} value={plan.mainTopic} maxLength={300} placeholder="Ex.: rentabilidade na criação de camarão" onChange={e => change({ mainTopic: e.target.value })} />}</FormRow>
    {compact && <FormRow label="Temas secundários" optional hint="Um por linha. Na pauta, escolha quais virarão textos separados.">{({ id }) => <Textarea id={id} value={plan.secondaryTopics.join('\n')} maxLength={6000} autoSize={{ minRows: 2, maxRows: 8 }} onChange={e => change({ secondaryTopics: e.target.value.split('\n').slice(0, 20) })} />}</FormRow>}
    {plan.category === 'fair' && <>
      <FormRow label="Nome da feira ou evento">{({ id }) => <Input id={id} value={plan.eventName} maxLength={160} onChange={e => change({ eventName: e.target.value })} />}</FormRow>
      <FormRow label="Empresa ou instituição" optional>{({ id }) => <Input id={id} value={plan.company} maxLength={160} onChange={e => change({ company: e.target.value })} />}</FormRow>
      <FormRow label="Tema da palestra, painel ou premiação" optional>{({ id }) => <Input id={id} value={plan.sessionTitle} maxLength={300} onChange={e => change({ sessionTitle: e.target.value })} />}</FormRow>
    </>}
    {compact && <>
    <FormRow label="Geração"><Checkbox label="Priorizar rapidez na redação" description="Escreve o texto completo de uma vez, mantendo a estrutura revisada e a conferência de citações." checked={plan.fastDraft ?? false} onChange={event => change({ fastDraft: event.target.checked })} /></FormRow>
    <FormRow label="Palavra-chave principal" optional>{({ id }) => <Input id={id} value={plan.keyword} maxLength={300} onChange={e => change({ keyword: e.target.value })} />}</FormRow>
    <FormRow label="Intenção de busca" optional>{({ id }) => <Input id={id} value={plan.searchIntent} maxLength={600} placeholder="Qual dúvida do leitor este conteúdo responde?" onChange={e => change({ searchIntent: e.target.value })} />}</FormRow>
    <FormRow label="Instruções para esta produção" optional hint="Peça ajustes de abordagem, estrutura ou linguagem; indique os eventos presentes no mesmo áudio.">{({ id }) => <Textarea id={id} value={plan.instructions} maxLength={6000} autoSize={{ minRows: 3, maxRows: 10 }} onChange={e => change({ instructions: e.target.value })} />}</FormRow>
    </>}
    {compact && <Button variant="ghost" size="sm" onClick={() => {
      if (!preferenceKey) return;
      try {
        localStorage.setItem(preferenceKey + ':preferences', plan.instructions);
        toast('Orientações salvas para próximas produções', { description: 'Preferência da sua conta neste navegador.' });
      } catch { toast('Não foi possível salvar a preferência', { tone: 'error' }); }
    }}>Usar orientações como padrão</Button>}
  </FormSection>;
}
