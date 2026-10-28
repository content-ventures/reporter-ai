'use client';
import { useCallback, useState } from 'react';
import { Alert, Badge, Button, ButtonGroup, Checkbox, DescriptionList, Drawer, ErrorState, Field, Input, Panel, Section, Select, Spinner, Textarea, TextLink } from '@content-ventures/design-system/v3';
import type { MemoryDecisionAction, MemoryHistoryKind, MemoryMaterial } from '@/domain/editorial-memory';
import { memoryEvidenceRef } from '@/domain/editorial-memory';
import { VERDICT_LABELS } from '@/domain/fact-check';
import type { MemoryDetail, MemoryHistoryEntry, MemoryLibrary } from '@/ports/editorial-memory';
import { useMemoryResource } from '@/state/use-memory-library';
import { useCan, usePeople } from '@/state';

export const ELIGIBILITY_LABELS = { ready: 'Disponível para uso', source_unavailable: 'Conferir fonte e autorização', withdrawn: 'Retirada', authorship_pending: 'Confirmar autoria', review_required: 'Aguardando revisão', rejected: 'Rejeitada' };
const REVIEW_LABELS: Record<MemoryDecisionAction, string> = { accept: 'Aceitar', reject: 'Rejeitar', request_revision: 'Solicitar revisão' };
const HISTORY_LABELS: Record<MemoryHistoryKind, string> = { checks: 'Checagens', decisions: 'Decisões', revisions: 'Revisões', occurrences: 'Ocorrências' };
export function MemoryEvidenceDrawer({ id, onClose, onChanged, onMaterial }: { id: string; onClose: () => void; onChanged: () => void; onMaterial: (material: MemoryMaterial) => void }) {
  const load = useCallback((port: MemoryLibrary) => port.detail(id), [id]), resource = useMemoryResource(load);
  return <Drawer open size="lg" title="Evidência" onClose={onClose}>
    {resource.error ? <ErrorState title="Não foi possível abrir a evidência" description={resource.error} onRetry={resource.reload} /> : !resource.data || !resource.port ? <Spinner label="Carregando evidência" /> :
      <EvidenceContent key={`${id}:${resource.data.evidence.revision}:${resource.data.decision?.sequence ?? 0}`} detail={resource.data} port={resource.port} onMaterial={onMaterial} onChanged={() => { resource.reload(); onChanged(); }} />}
  </Drawer>;
}
function EvidenceContent({ detail, port, onChanged, onMaterial }: { detail: MemoryDetail; port: MemoryLibrary; onChanged: () => void; onMaterial: (material: MemoryMaterial) => void }) {
  const { evidence, check, decision } = detail, people = usePeople(), canEdit = useCan('library.edit'), canReview = useCan('library.review');
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState<string>();
  const [personId, setPersonId] = useState(evidence.kind === 'citation' ? evidence.personId ?? '' : ''), [confirmed, setConfirmed] = useState(evidence.kind === 'citation' && evidence.authorConfirmed);
  const [indicator, setIndicator] = useState(evidence.kind === 'statistic' ? evidence.indicator : ''), [unit, setUnit] = useState(evidence.kind === 'statistic' ? evidence.unit : '');
  const [statistic, setStatistic] = useState(evidence.kind === 'statistic' ? { raw: evidence.value.raw, period: evidence.period?.label ?? '', from: evidence.period?.from ?? '', to: evidence.period?.to ?? '', geography: evidence.geography ?? '', population: evidence.population ?? '', qualifier: evidence.qualifier ?? '', issuingInstitution: evidence.issuingInstitution ?? '', declaringPersonId: evidence.declaringPersonId ?? '' } : null);
  const [otherMetadata, setOtherMetadata] = useState({ company: evidence.metadata.company ?? '', event: evidence.metadata.event ?? '', edition: evidence.metadata.edition ?? '', topics: evidence.metadata.topics.join(', '), originalUrl: evidence.metadata.originalUrl ?? '' });
  const [institution, setInstitution] = useState(evidence.metadata.institution ?? ''), [recordedOn, setRecordedOn] = useState(evidence.metadata.recordedOn ?? ''), [publishedOn, setPublishedOn] = useState(evidence.metadata.publishedOn ?? '');
  const execute = async (operation: () => Promise<unknown>) => {
    setBusy(true); setError(undefined);
    try { await operation(); onChanged(); } catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível salvar.'); }
    finally { setBusy(false); }
  };
  const person = (id: string | null) => people.data?.find(item => item.id === id)?.name ?? id ?? 'Não informada';
  const review = (action: MemoryDecisionAction) => execute(() => port.review(evidence.id, {
    evidence: memoryEvidenceRef(evidence), check: check ? { id: check.id, revision: check.revision } : null, policyRevision: detail.policy.revision,
    previousSequence: decision?.sequence ?? 0, action, reason, supports: [],
  }, crypto.randomUUID()));
  return <Panel>
    <Section title={evidence.kind === 'citation' ? 'Citação literal' : evidence.indicator} meta={<Badge tone={detail.eligibility.usable ? 'green' : 'amber'}>{ELIGIBILITY_LABELS[detail.eligibility.reason]}</Badge>}>
      <Textarea aria-label="Trecho literal" readOnly value={evidence.anchor.excerpt} rows={6} />
      <DescriptionList items={[{ label: 'Material', value: <Button variant="ghost" onClick={() => onMaterial(detail.material)}>{detail.material.title}</Button> },
        { label: 'Autoria', value: evidence.kind === 'citation' ? person(evidence.personId) : person(evidence.declaringPersonId) },
        { label: 'Veredito', value: check ? VERDICT_LABELS[check.verdict] : 'Sem checagem' }, { label: 'Confiança factual', value: check?.confidence === null || check?.confidence === undefined ? 'Não calculada' : `${check.confidence}%` },
        { label: 'Força editorial', value: check?.strength ? `${check.strength.score} — ${check.strength.reason}` : 'Não calculada' },
        { label: 'Usos em artigos', value: detail.uses.inserted }, { label: 'Usos aprovados', value: detail.uses.approved }, { label: 'Publicações', value: detail.uses.published }]} />
      {evidence.kind === 'statistic' && <DescriptionList items={[{ label: 'Valor original', value: evidence.value.raw }, { label: 'Unidade', value: evidence.unit },
        { label: 'Período', value: evidence.period?.label }, { label: 'População', value: evidence.population }, { label: 'Geografia', value: evidence.geography },
        { label: 'Ressalva', value: evidence.qualifier }, { label: 'Instituição emissora', value: evidence.issuingInstitution }]} />}
      {check?.supports.map((support, index) => <Section key={index} titleAs="h3" title={support.relation === 'contradicts' ? 'Contraponto' : 'Fonte da checagem'}>
        {support.evidence.kind === 'external' && <TextLink href={support.evidence.url} target="_blank" rel="noreferrer">{support.evidence.title}</TextLink>}
        <Textarea aria-label={`Trecho da fonte ${index + 1}`} readOnly rows={3} value={support.evidence.excerpt} />
      </Section>)}
    </Section>
    {(canEdit || canReview) && !detail.reviewRestricted && <Section title="Revisão editorial">
      {error && <Alert tone="danger" title={error} />}
      <Field label="Motivo da alteração ou decisão" required>{({ id }) => <Textarea id={id} rows={3} maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} />}</Field>
      {canEdit && <>
        {evidence.kind === 'citation' ? <>
          <Field label="Pessoa que fez a declaração">{({ id }) => <Select id={id} value={personId} searchable options={[{ value: '', label: 'Autoria não identificada' }, ...(people.data ?? []).map(item => ({ value: item.id, label: item.name }))]} onChange={setPersonId} />}</Field>
          <Checkbox label="Conferi a autoria no original" checked={confirmed} disabled={!personId} onChange={event => setConfirmed(event.target.checked)} />
        </> : <>
          <Field label="Indicador">{({ id }) => <Input id={id} value={indicator} onChange={event => setIndicator(event.target.value)} />}</Field>
          <Field label="Unidade literal">{({ id }) => <Input id={id} value={unit} onChange={event => setUnit(event.target.value)} />}</Field>
          {statistic && <>
            {([{ key: 'raw', label: 'Valor literal' }, { key: 'period', label: 'Período descrito' }, { key: 'from', label: 'Início do período', type: 'date' }, { key: 'to', label: 'Fim do período', type: 'date' }, { key: 'geography', label: 'Geografia' }, { key: 'population', label: 'População ou amostra' }, { key: 'qualifier', label: 'Ressalva literal' }, { key: 'issuingInstitution', label: 'Instituição emissora' }] as const).map(field => <Field key={field.key} label={field.label}>{({ id }) => <Input id={id} type={'type' in field ? field.type : 'text'} value={statistic[field.key]} onChange={event => setStatistic({ ...statistic, [field.key]: event.target.value })} />}</Field>)}
            <Field label="Pessoa que declarou o dado">{({ id }) => <Select id={id} value={statistic.declaringPersonId} searchable options={[{ value: '', label: 'Não identificada' }, ...(people.data ?? []).map(item => ({ value: item.id, label: item.name }))]} onChange={value => setStatistic({ ...statistic, declaringPersonId: value })} />}</Field>
          </>}

        </>}
        <Field label="Instituição">{({ id }) => <Input id={id} value={institution} onChange={event => setInstitution(event.target.value)} />}</Field>
        <Field label="Data da fala">{({ id }) => <Input id={id} type="date" value={recordedOn} onChange={event => setRecordedOn(event.target.value)} />}</Field>
        <Field label="Data de publicação">{({ id }) => <Input id={id} type="date" value={publishedOn} onChange={event => setPublishedOn(event.target.value)} />}</Field>
        {([{ key: 'company', label: 'Empresa' }, { key: 'event', label: 'Evento' }, { key: 'edition', label: 'Edição' }, { key: 'topics', label: 'Temas separados por vírgula' }, { key: 'originalUrl', label: 'URL original' }] as const).map(field => <Field key={field.key} label={field.label}>{({ id }) => <Input id={id} value={otherMetadata[field.key]} onChange={event => setOtherMetadata({ ...otherMetadata, [field.key]: event.target.value })} />}</Field>)}
        <Button variant="secondary" loading={busy} disabled={!reason.trim()} onClick={() => void execute(() => port.correct(evidence.id, { expected: memoryEvidenceRef(evidence), reason,
          changes: { kind: evidence.kind, metadata: { institution: institution || null, recordedOn: recordedOn || null, publishedOn: publishedOn || null, company: otherMetadata.company || null, event: otherMetadata.event || null, edition: otherMetadata.edition || null, originalUrl: otherMetadata.originalUrl || null, topics: otherMetadata.topics.split(',').map(item => item.trim()).filter(Boolean) },
            ...(evidence.kind === 'citation' ? { personId: personId || null, authorConfirmed: Boolean(personId && confirmed) } : { indicator, unit, ...(statistic ? { value: evidence.kind === 'statistic' && statistic.raw === evidence.value.raw ? evidence.value : { raw: statistic.raw, decimal: null, lower: null, upper: null, scale: null }, period: statistic.period ? { label: statistic.period, from: statistic.from || null, to: statistic.to || null } : null, geography: statistic.geography || null, population: statistic.population || null, qualifier: statistic.qualifier || null, issuingInstitution: statistic.issuingInstitution || null, declaringPersonId: statistic.declaringPersonId || null } : {}) }) },
        }, crypto.randomUUID()))}>Salvar correção</Button>
      </>}
      {canEdit && evidence.kind === 'citation' && evidence.legacy?.state === 'conflict' && <ButtonGroup label="Resolver divergência">
        {(['keep_bank', 'apply_legacy'] as const).map(choice => <Button key={choice} variant="secondary" disabled={!reason.trim()} loading={busy} onClick={() => void execute(() => port.resolveLegacy(evidence.id, { expected: memoryEvidenceRef(evidence), legacyHash: evidence.legacy!.hash, choice, reason }, crypto.randomUUID()))}>{choice === 'keep_bank' ? 'Preservar correção do banco' : 'Aplicar versão da citação antiga'}</Button>)}
      </ButtonGroup>}
      {canEdit && evidence.deduplication?.state === 'pending' && <ButtonGroup label="Resolver duplicata">
        {(['keep_variant', 'use_curated'] as const).map(choice => <Button key={choice} variant="secondary" disabled={!reason.trim()} loading={busy} onClick={() => void execute(async () => {
          const canonical = await port.detail(evidence.deduplication!.canonicalId);
          return port.resolveDuplicate(evidence.id, { expected: memoryEvidenceRef(evidence), canonical: memoryEvidenceRef(canonical.evidence), choice, reason }, crypto.randomUUID());
        })}>{choice === 'keep_variant' ? 'Preservar correção desta variante' : 'Usar versão já curada'}</Button>)}
      </ButtonGroup>}
      {canReview && <ButtonGroup label="Ações">{(['accept', 'reject', 'request_revision'] as const).map(action => <Button key={action} variant={action === 'accept' ? 'primary' : 'secondary'} loading={busy} disabled={!reason.trim() || action === 'accept' && ['source_unavailable', 'withdrawn', 'authorship_pending'].includes(detail.eligibility.reason)} onClick={() => void review(action)}>{REVIEW_LABELS[action]}</Button>)}</ButtonGroup>}
      {decision && <DescriptionList items={[{ label: 'Última decisão', value: REVIEW_LABELS[decision.action] }, { label: 'Responsável', value: person(decision.personId) }, { label: 'Data', value: new Date(decision.at).toLocaleString('pt-BR') }, { label: 'Motivo', value: decision.reason }]} />}
    </Section>}
    {(['checks', 'decisions', 'revisions', 'occurrences'] as const).map(kind => <MemoryHistory key={kind} detail={detail} port={port} kind={kind} />)}
  </Panel>;
}
function MemoryHistory({ detail, port, kind }: { detail: MemoryDetail; port: MemoryLibrary; kind: MemoryHistoryKind }) {
  const [items, setItems] = useState<MemoryHistoryEntry[]>(detail[kind].items), [cursor, setCursor] = useState(detail[kind].nextCursor), [busy, setBusy] = useState(false), [error, setError] = useState<string>();
  return <Section title={HISTORY_LABELS[kind]} meta={detail[kind].total}>
    {error && <Alert tone="danger" title={error} />}
    <DescriptionList items={items.map((item, index) => ({ label: `${index + 1}`, value: 'action' in item ? `${REVIEW_LABELS[item.action]} — ${item.reason} · ${item.personId} · ${new Date(item.at).toLocaleString('pt-BR')}`
      : 'stage' in item ? `${item.stage} · ${item.personId} · ${item.at}` : 'verdict' in item ? `${VERDICT_LABELS[item.verdict]} · ${item.checkedAt}` : `Revisão ${item.revision} · ${item.updatedAt}` }))} />
    {cursor && <Button variant="secondary" loading={busy} onClick={async () => { setBusy(true); setError(undefined);
      try { const next = await port.history(detail.evidence.id, kind, { cursor }); setItems(current => [...current, ...next.items]); setCursor(next.nextCursor); }
      catch (failure) { setError(failure instanceof Error ? failure.message : 'Não foi possível carregar o histórico.'); } finally { setBusy(false); }
    }}>Carregar mais</Button>}
  </Section>;
}
