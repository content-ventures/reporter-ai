'use client';

import { Accordion, Alert, CopyButton, DescriptionList, EmptyState, Field, PageStack, Panel, Prose, Section, Textarea } from '@content-ventures/design-system/v3';
import type { AccordionItem } from '@content-ventures/design-system/v3';
import { pipelineModelLabel } from '@/domain/pipeline';
import { WRITING_EDITORIAL_CHECK_KEYS, WRITING_EDITORIAL_CHECK_LABELS, WRITING_STAGE_LABELS } from '@/domain/writing-orchestration';
import type { WritingTrace } from '@/domain/writing-orchestration';
import { readWritingTemporalContext } from '@/domain/writing-context';
import type { WritingRunDetails as RunDetails } from '@/ports/pipeline-settings';
import { researchSnapshotFrom, WritingResearchDetails } from './writing-research-details';

const STATUS: Record<string, string> = { completed: 'Concluída', failed: 'Falhou', running: 'Em andamento', queued: 'Na fila', cancelled: 'Cancelada' };
const DECISION: Record<string, string> = { ready: 'Pronto para redação', ready_for_human: 'Pronto para revisão humana', revise: 'Precisa de correção', needs_reporting: 'Precisa de apuração' };
const EFFORT: Record<string, string> = { low: 'Baixo', medium: 'Médio', high: 'Alto', xhigh: 'Muito alto', max: 'Máximo' };
const SEVERITY: Record<string, string> = { critical: 'Crítico', major: 'Relevante', minor: 'Sugestão opcional' };
const stageLabel = (stage: WritingTrace['stage']) => stage === 'research' ? 'Pesquisar contexto' : WRITING_STAGE_LABELS[stage];
const tokens = (value: number | null | undefined) => typeof value === 'number' ? new Intl.NumberFormat('pt-BR').format(value) : 'Não informado';
const elapsed = (trace: WritingTrace) => trace.completedAt
  ? `${Math.max(0, (Date.parse(trace.completedAt) - Date.parse(trace.startedAt)) / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s`
  : 'Em andamento';
function decision(output: unknown) {
  if (!output || typeof output !== 'object') return undefined;
  const value = (output as { decision?: unknown }).decision;
  return typeof value === 'string' ? DECISION[value] ?? value : undefined;
}
function findings(output: unknown) {
  if (!output || typeof output !== 'object') return [];
  const issues = (output as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) return [];
  return issues.flatMap((issue: unknown, index) => {
    if (typeof issue === 'string') return [{ id: String(index), title: 'Apuração registrada', message: issue, optional: false }];
    if (!issue || typeof issue !== 'object') return [];
    const record = issue as Record<string, unknown>;
    if (typeof record.message !== 'string') return [];
    return [{ id: String(record.id ?? index), title: typeof record.severity === 'string' ? SEVERITY[record.severity] ?? record.severity : 'Apontamento',
      message: [record.message, typeof record.suggestion === 'string' && record.suggestion].filter(Boolean).join('\n'), optional: record.severity === 'minor' }];
  });
}
function summary(output: unknown) {
  if (!output || typeof output !== 'object') return undefined;
  const record = output as Record<string, unknown>;
  return typeof record.summary === 'string' ? record.summary : undefined;
}

const FACT_STATUS: Record<string, string> = { preserved: 'Preservado', partial: 'Parcial', missing: 'Ausente', contradicted: 'Contradito' };
const ISSUE_STATUS: Record<string, string> = { resolved: 'Resolvido', unresolved: 'Não resolvido' };
const EDITORIAL_STATUS: Record<string, string> = { pass: 'Atendido', revise: 'Revisar' };
type Data = Record<string, unknown>;
function record(value: unknown): Data | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Data : undefined; }
function records(value: unknown): Data[] { return Array.isArray(value) ? value.flatMap(item => record(item) ? [record(item)!] : []) : []; }
function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []; }
function string(value: unknown) { return typeof value === 'string' ? value : ''; }
function executionInput(trace: WritingTrace): Data {
  const start = trace.prompt.user.indexOf('{');
  if (start < 0) return {};
  try { return record(JSON.parse(trace.prompt.user.slice(start))) ?? {}; } catch { return {}; }
}
const calendarDate = (value: string) => value.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3/$2/$1');
function temporalContextItem(trace: WritingTrace): AccordionItem {
  const brief = record(executionInput(trace).brief), context = readWritingTemporalContext(brief), event = record(brief?.event);
  return { id: `${trace.id}-temporal-context`, title: `Ver datas e contexto · ${stageLabel(trace.stage)}`, content: <PageStack>
    <DescriptionList items={[
      { label: 'Data da execução enviada ao modelo', value: context ? calendarDate(context.executionDate) : 'Contexto temporal não registrado nesta execução.' },
      ...(string(event?.name) ? [{ label: 'Evento informado na pauta', value: string(event?.name) },
        { label: 'Período informado do evento', value: string(event?.dates) || 'Não informado na pauta.' }] : []),
    ]} />
    {context && (context.sources.length ? context.sources.map(source => <DescriptionList key={source.sourceId} items={[
      { label: 'Conteúdo de origem', value: source.title || source.sourceId },
      { label: 'Identificador da fonte', value: source.sourceId },
      { label: 'Data informada no conteúdo', value: source.recordedOn ? calendarDate(source.recordedOn) : 'Não informada.' },
    ]} />) : <Prose variant="compact" measure="wide">Nenhuma fonte foi registrada no contexto temporal.</Prose>)}
  </PageStack> };
}
function planItems(trace: WritingTrace): AccordionItem[] {
  if (trace.stage !== 'plan') return [];
  const plan = record(trace.output);
  if (!plan) return [];
  const outline = strings(plan.outline);
  return [{ id: `${trace.id}-plan`, title: 'Ver pauta e progressão', content: <DescriptionList items={[
    { label: 'Ângulo escolhido', value: string(plan.angle) || 'Não registrado.' },
    ...(outline.length ? outline.map((point, index) => ({ label: `Ordem ${index + 1}`, value: point }))
      : [{ label: 'Progressão do artigo', value: 'Não registrada.' }]),
  ]} /> }];
}
function webContextItems(trace: WritingTrace): AccordionItem[] {
  const snapshot = researchSnapshotFrom(executionInput(trace).research);
  return snapshot ? [{ id: `${trace.id}-web-context`, title: `Ver contexto web recebido · ${stageLabel(trace.stage)}`,
    content: <WritingResearchDetails snapshot={snapshot} showQueries={false} /> }] : [];
}
function articleBlock(article: Data | undefined, id: string) {
  if (id === 'title' || id === 'dek') return string(article?.[id]);
  const block = records(article?.blocks).find(item => item.id === id);
  return block?.type === 'list' ? strings(block.items).join('\n') : string(block?.text);
}
function ArticlePassages({ passages, article }: { passages: Data[]; article: Data | undefined }) {
  return passages.length ? <PageStack>
    {passages.map((passage, index) => <DescriptionList key={`${string(passage.blockId)}-${index}`} items={[
      { label: 'Bloco do artigo', value: string(passage.blockId) },
      { label: 'Trecho indicado pelo revisor', value: string(passage.text) },
      { label: 'Texto do bloco nesta revisão', value: articleBlock(article, string(passage.blockId)) || 'Não disponível na entrada registrada.' },
    ]} />)}
  </PageStack> : <Prose variant="compact" measure="wide">Nenhum trecho do artigo foi indicado.</Prose>;
}
function editorialAuditItems(trace: WritingTrace, audit: Data, article: Data | undefined): AccordionItem[] {
  if (!Array.isArray(audit.editorialChecks)) return [{ id: `${trace.id}-editorial-unavailable`, title: 'Verificação editorial por eixo não registrada', content:
    <Prose variant="compact" measure="wide">Esta execução não registra a avaliação por eixo editorial. O resumo e os demais registros continuam disponíveis; não há resultado individual de hierarquia, economia, citações, linguagem ou incertezas.</Prose> }];
  const checks = records(audit.editorialChecks), issues = records(record(trace.output)?.issues);
  return WRITING_EDITORIAL_CHECK_KEYS.map(criterion => {
    const check = checks.find(item => item.criterion === criterion), status = string(check?.status);
    const issueIds = strings(check?.issueIds);
    return { id: `${trace.id}-editorial-${criterion}`, title: `Edição · ${WRITING_EDITORIAL_CHECK_LABELS[criterion]} · ${EDITORIAL_STATUS[status] ?? 'Não verificado'}`,
      status: status === 'pass' ? 'done' as const : 'warning' as const,
      content: <PageStack>
        <DescriptionList items={[
          { label: 'Eixo editorial', value: WRITING_EDITORIAL_CHECK_LABELS[criterion] },
          { label: 'Resultado', value: EDITORIAL_STATUS[status] ?? 'Não verificado' },
          { label: 'Justificativa do revisor', value: string(check?.reason) || 'Não registrada.' },
        ]} />
        <ArticlePassages passages={records(check?.articlePassages)} article={article} />
        {issueIds.length ? <DescriptionList items={issueIds.map(issueId => {
          const issue = issues.find(item => item.id === issueId);
          const severity = SEVERITY[string(issue?.severity)] ?? string(issue?.severity);
          return { label: `Apontamento · ${issueId}`, value: issue
            ? [[severity, string(issue.message)].filter(Boolean).join(': '), string(issue.suggestion) ? `Correção sugerida: ${string(issue.suggestion)}` : ''].filter(Boolean).join('\n')
            : 'Apontamento não encontrado no resultado registrado.' };
        })} /> : <Prose variant="compact" measure="wide">Nenhum apontamento vinculado a este eixo.</Prose>}
      </PageStack> };
  });
}
function reviewAuditItems(trace: WritingTrace): AccordionItem[] {
  if (trace.stage !== 'review' || trace.output === undefined) return [];
  const audit = record(record(trace.output)?.audit);
  if (!audit) return [{ id: `${trace.id}-audit-unavailable`, title: 'Verificação estruturada não registrada', content:
    <Prose variant="compact" measure="wide">Esta resposta não registra a preservação de cada fato essencial, a resolução dos apontamentos anteriores ou a avaliação por eixo editorial. Consulte os prompts e o resultado desta execução.</Prose> }];
  const input = executionInput(trace), plan = record(input.plan), article = record(input.article), previousArticle = record(input.previousArticle);
  const source = records(input.source), facts = records(plan?.facts), checks = records(audit.factChecks);
  const factIds = [...new Set([...strings(plan?.essentialFactIds), ...checks.map(check => string(check.factId)).filter(Boolean)])];
  const previousIssues = records(record(input.review)?.issues), issueChecks = records(audit.issueChecks);
  const issueIds = [...new Set([...previousIssues.map(issue => string(issue.id)), ...issueChecks.map(check => string(check.issueId))].filter(Boolean))];
  return [
    { id: `${trace.id}-audit-summary`, title: 'Ver revisão factual e editorial', content: <DescriptionList items={[
      { label: 'Fidelidade factual', value: string(audit.factualSummary) || 'Não registrada.' },
      { label: 'Edição jornalística', value: string(audit.editorialSummary) || 'Não registrada.' },
    ]} /> },
    ...editorialAuditItems(trace, audit, article),
    ...(factIds.length ? factIds.map(factId => {
      const fact = facts.find(item => item.id === factId), check = checks.find(item => item.factId === factId);
      const status = string(check?.status), evidenceIds = strings(check?.evidenceIds);
      return { id: `${trace.id}-fact-${factId}`, title: `Fato essencial · ${factId} · ${FACT_STATUS[status] ?? 'Não verificado'}`,
        status: status === 'preserved' ? 'done' as const : 'warning' as const,
        content: <PageStack>
          <DescriptionList items={[
            { label: 'Fato essencial do plano', value: string(fact?.text) || 'Não disponível na entrada registrada.' },
            { label: 'Resultado', value: FACT_STATUS[status] ?? 'Não verificado' },
            { label: 'Análise do revisor', value: string(check?.reason) || 'Não registrada.' },
          ]} />
          <ArticlePassages passages={records(check?.articlePassages)} article={article} />
          <DescriptionList items={(evidenceIds.length ? evidenceIds : strings(fact?.evidenceIds)).map(id => {
            const evidence = source.find(item => item.id === id);
            return { label: `Fonte · ${id}`, value: evidence ? [string(evidence.speaker), string(evidence.text)].filter(Boolean).join(': ') : 'Trecho não disponível na entrada registrada.' };
          })} />
        </PageStack> };
    }) : [{ id: `${trace.id}-fact-checks`, title: 'Ver preservação dos fatos essenciais', content: <Prose variant="compact" measure="wide">Nenhum fato essencial foi registrado nesta resposta ou em sua entrada.</Prose> }]),
    ...(issueIds.length ? issueIds.map(issueId => {
      const issue = previousIssues.find(item => item.id === issueId), check = issueChecks.find(item => item.issueId === issueId);
      const status = string(check?.status);
      const originalSeverity = string(issue?.severity), optional = originalSeverity === 'minor';
      const resolution = optional && status === 'unresolved' ? 'Não resolvida · opcional' : ISSUE_STATUS[status] ?? 'Não verificado';
      const previousBlockId = articleBlock(previousArticle, string(issue?.blockId))
        ? string(issue?.blockId) : string(records(check?.articlePassages)[0]?.blockId);
      const previousText = articleBlock(previousArticle, previousBlockId);
      return { id: `${trace.id}-issue-${issueId}`, title: `${optional ? 'Sugestão' : 'Correção'} · ${issueId} · ${resolution}`,
        status: status === 'resolved' ? 'done' as const : optional ? undefined : 'warning' as const,
        content: <PageStack>
          <DescriptionList items={[
            { label: 'Apontamento anterior', value: string(issue?.message) || 'Não disponível na entrada registrada.' },
            { label: 'Gravidade original', value: SEVERITY[originalSeverity] ?? (originalSeverity || 'Não registrada.') },
            { label: 'Correção solicitada', value: string(issue?.suggestion) || 'Não disponível na entrada registrada.' },
            ...(previousText ? [{ label: 'Bloco antes da correção', value: previousBlockId }, { label: 'Texto anterior do bloco', value: previousText }] : []),
            { label: 'Resultado', value: resolution },
            { label: 'Análise após a correção', value: string(check?.reason) || 'Não registrada.' },
          ]} />
          <ArticlePassages passages={records(check?.articlePassages)} article={article} />
        </PageStack> };
    }) : [{ id: `${trace.id}-issue-checks`, title: 'Ver resolução dos apontamentos', content: <Prose variant="compact" measure="wide">Nenhum apontamento anterior foi enviado para esta revisão.</Prose> }]),
  ];
}

/** Immutable request and response evidence, separate from the currently editable configuration. */
export function WritingRunDetails({ run }: { run: RunDetails }) {
  const policy = run.pipeline.definition.editorial;
  const configuredMinimum = run.pipeline.definition.writing?.minimumQuotes;
  const recordedMinimum = run.traces.map(trace => record(record(executionInput(trace).brief)?.limits)?.minQuotes)
    .find((value): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0);
  const minimumQuotes = recordedMinimum ?? (typeof configuredMinimum === 'number' ? configuredMinimum : undefined);
  const quoteMinimumLabel = minimumQuotes === undefined ? 'Padrão do formato; quantidade não registrada.'
    : (minimumQuotes === 0 ? 'Sem mínimo obrigatório (0)' : String(minimumQuotes)) + (configuredMinimum == null ? ' · padrão do formato' : '');
  return <PageStack>
    {run.error && <Alert tone="danger" title="A execução precisa de atenção">{run.error}</Alert>}
    <DescriptionList items={[
      { label: 'Estado', value: STATUS[run.status] ?? run.status },
      { label: 'Configuração usada', value: `Revisão ${run.pipeline.revision}` },
      { label: 'Mapa e guia usados', value: `Mapa v${policy?.map.version ?? 0} · guia v${policy?.guide.version ?? 0}` },
      { label: 'Mínimo de citações diretas', value: quoteMinimumLabel },
      { label: 'Etapas registradas', value: String(run.traces.length) },
    ]} />
    {!run.traces.length && <EmptyState size="inline" title="Nenhuma etapa registrada ainda" />}
    {run.traces.map(trace => {
      const label = stageLabel(trace.stage);
      if (trace.stage === 'research') return <Panel key={trace.id}><Section title={`${label} · tentativa ${trace.attempt}`} titleAs="h3">
        <PageStack>
          {trace.error && <Alert tone="danger" title="Falha na pesquisa">{trace.error}</Alert>}
          <DescriptionList items={[
            { label: 'Estado da etapa', value: STATUS[trace.status] ?? trace.status },
            { label: 'Serviço de pesquisa', value: 'Tavily · Search Basic' },
            { label: 'Duração', value: elapsed(trace) },
            { label: 'Pesquisa reutilizada', value: trace.cached === undefined ? 'Não informado' : trace.cached ? 'Sim' : 'Não' },
            { label: 'Tratamento de falha configurado', value: run.pipeline.definition.writing?.research?.failureMode === 'continue_original'
              ? 'Continuar com o conteúdo original' : 'Parar e analisar a falha' },
          ]} />
          {trace.research ? <WritingResearchDetails snapshot={trace.research} />
            : <EmptyState size="inline" title={trace.status === 'running' ? 'A pesquisa está em andamento' : 'Detalhes da pesquisa não registrados'} />}
          <Accordion headingLevel="h4" items={[
            { id: `${trace.id}-research-request`, title: 'Ver pedido de pesquisa', content: <Field label="Pedido de pesquisa registrado">
              {props => <Textarea id={props.id} readOnly rows={10} value={trace.prompt.user} />}
            </Field> },
            { id: `${trace.id}-research-identity`, title: 'Ver identificação da pesquisa', content: <DescriptionList items={[
              { label: 'Identificador da etapa', value: trace.id }, { label: 'Hash da pesquisa', value: trace.hash },
              { label: 'Início', value: trace.startedAt }, { label: 'Fim', value: trace.completedAt ?? 'Não concluída' },
            ]} /> },
          ]} />
        </PageStack>
      </Section></Panel>;
      const outcome = decision(trace.output);
      const notes = findings(trace.output);
      const note = summary(trace.output);
      const output = trace.output === undefined ? 'Nenhuma resposta registrada.' : JSON.stringify(trace.output, null, 2);
      return <Panel key={trace.id}><Section title={`${label} · tentativa ${trace.attempt}`} titleAs="h3">
        <PageStack>
          {trace.error && <Alert tone="danger" title="Falha na etapa">{trace.error}</Alert>}
          {trace.reason && <Alert tone="warning" title="Motivo registrado">{trace.reason}</Alert>}
          <DescriptionList items={[
            { label: 'Estado da etapa', value: STATUS[trace.status] ?? trace.status },
            ...(trace.executionAttempt === undefined ? [] : [{ label: 'Tentativa da execução', value: String(trace.executionAttempt) }]),
            { label: 'Modelo usado', value: pipelineModelLabel(trace.model) },
            ...(trace.parameters ? [
              { label: 'Limite de saída usado', value: `${tokens(trace.parameters.maxTokens)} tokens` },
              ...(trace.parameters.effort ? [{ label: 'Esforço de raciocínio usado', value: EFFORT[trace.parameters.effort] ?? trace.parameters.effort }] : []),
              ...(trace.parameters.temperature === undefined ? [] : [{ label: 'Temperatura usada', value: String(trace.parameters.temperature) }]),
            ] : [{ label: 'Parâmetros usados', value: 'Não registrados nesta execução.' }]),
            { label: 'Duração', value: elapsed(trace) },
            { label: 'Tokens de entrada', value: tokens(trace.inputTokens) },
            { label: 'Tokens de saída', value: tokens(trace.outputTokens) },
            { label: 'Resultado reutilizado', value: trace.cached === undefined ? 'Não informado' : trace.cached ? 'Sim' : 'Não' },
            ...(outcome ? [{ label: 'Decisão', value: outcome }] : []),
          ]} />
          {note && <Prose variant="compact" measure="wide">{note}</Prose>}
          <Accordion headingLevel="h4" items={[
            temporalContextItem(trace),
            ...planItems(trace),
            ...webContextItems(trace),
            ...reviewAuditItems(trace),
            ...(notes.length ? [{ id: `${trace.id}-findings`, title: `Ver apontamentos · ${label}`, content: <PageStack>
              {notes.map(item => item.optional
                ? <DescriptionList key={item.id} items={[{ label: `${item.title} · ${item.id}`, value: item.message }]} />
                : <Alert key={item.id} tone="warning" title={item.title}>{item.message}</Alert>)}
            </PageStack> }] : []),
            { id: `${trace.id}-request`, title: `Ver prompt e entrada · ${label}`, content: <PageStack>
              <Field label={`Prompt de sistema · ${label}`}>{props => <Textarea id={props.id} readOnly rows={10} value={trace.prompt.system} />}</Field>
              <CopyButton text={trace.prompt.system} label={`Copiar prompt de sistema · ${label}`} />
              <Field label={`Entrada enviada · ${label}`}>{props => <Textarea id={props.id} readOnly rows={12} value={trace.prompt.user} />}</Field>
              <CopyButton text={trace.prompt.user} label={`Copiar entrada · ${label}`} />
            </PageStack> },
            { id: `${trace.id}-output`, title: `Ver resultado · ${label}`, content: <PageStack>
              <Field label={`Resultado registrado · ${label}`}>{props => <Textarea id={props.id} readOnly rows={12} value={output} />}</Field>
              <CopyButton text={output} label={`Copiar resultado · ${label}`} />
            </PageStack> },
            { id: `${trace.id}-identity`, title: `Ver identificação · ${label}`, content: <DescriptionList items={[
              { label: 'Início', value: trace.startedAt }, { label: 'Fim', value: trace.completedAt ?? 'Não concluída' },
              { label: 'Identificador da chamada', value: trace.id }, { label: 'Hash da entrada', value: trace.hash },
              ...(trace.provider ? [{ label: 'Provedor', value: trace.provider }] : []),
              ...(trace.requestId ? [{ label: 'Identificador no provedor', value: trace.requestId }] : []),
            ]} /> },
            ...(trace.providerOutput === undefined ? [] : [{ id: `${trace.id}-provider-output`, title: `Ver resposta anterior às verificações · ${label}`, content: <Field label={`Resposta original do modelo · ${label}`}>
              {props => <Textarea id={props.id} readOnly rows={12} value={JSON.stringify(trace.providerOutput, null, 2)} />}
            </Field> }]),
          ]} />
        </PageStack>
      </Section></Panel>;
    })}
    <Panel><Section title="Configuração preservada" titleAs="h3">
      <Accordion headingLevel="h4" items={[{ id: 'snapshot', title: 'Ver mapa, guia e etapas desta execução', content: <Field label="Configuração da execução">
        {props => <Textarea id={props.id} readOnly rows={12} value={JSON.stringify(run.pipeline.definition, null, 2)} />}
      </Field> }]} />
    </Section></Panel>
  </PageStack>;
}
