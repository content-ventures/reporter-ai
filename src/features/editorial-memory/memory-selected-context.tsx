'use client';
import { useCallback } from 'react';
import { Alert, Badge, Button, DescriptionList, ErrorState, Field, Panel, ResponsiveDialog, Section, Spinner, Textarea, TextLink } from '@content-ventures/design-system/v3';
import type { MemorySupport } from '@/domain/editorial-memory';
import { CLAIM_KIND_LABELS, CLAIM_VERDICT_LABELS, VERDICT_LABELS } from '@/domain/fact-check';
import type { MemoryLibrary, MemorySelectedContext, MemorySelectedContextInput } from '@/ports/editorial-memory';
import { usePeople, useSession } from '@/state';
import { useMemoryLibrary, useMemoryResource } from '@/state/use-memory-library';
import { MemoryDiscoveryDetails } from './memory-discovery';

export type MemoryContextBasis = { productionId: string; input: MemorySelectedContextInput; port: MemoryLibrary };

/** An explicit, read-only inspection of the proof used by this collection version. */
export function MemorySelectedContextDialog({ basis, open, onClose }: { basis: MemoryContextBasis; open: boolean; onClose: () => void }) {
  const port = useMemoryLibrary(), { productionId, input } = basis, bound = port === basis.port;
  const load = useCallback((library: MemoryLibrary) => library.selectedContext(productionId, input), [productionId, input]);
  const resource = useMemoryResource(load, 0, bound && open);
  return <ResponsiveDialog open={open} title="Origem da evidência selecionada" size="lg" onClose={onClose}
    footer={<Button variant="ghost" onClick={onClose}>Fechar</Button>}>
    {!bound ? <ErrorState title="A conta mudou" description="Feche esta consulta e abra a evidência na conta atual." />
      : resource.error ? <ErrorState title="Não foi possível consultar a origem" description={resource.error} onRetry={resource.reload} />
      : !resource.data ? <Spinner label="Consultando o contexto da seleção" /> : <SelectedContext context={resource.data} />}
  </ResponsiveDialog>;
}

function SelectedContext({ context }: { context: MemorySelectedContext }) {
  const { evidence, original, selection, check, decision } = context, people = usePeople(), session = useSession().data;
  const person = (id: string | null) => people.data?.find(item => item.id === id)?.name
    ?? (id === session?.current?.id ? session?.current?.name : session?.members.find(member => member.id === id)?.name) ?? id ?? 'Não informada';
  return <Panel>
    <Section title="Contexto do trecho">
      {context.readOnly && <Badge>Somente consulta</Badge>}
      {!context.current.matchesSelection && <Alert tone="warning" title="A seleção precisa ser conferida antes de novo uso">A evidência ou suas condições de uso mudaram. Esta consulta preserva a revisão selecionada.</Alert>}
      {!original.authorized && <Alert tone="warning" title="A autorização da fonte original foi retirada" />}
      {original.before && <Field label="Contexto anterior">{({ id }) => <Textarea id={id} readOnly rows={3} value={original.before} />}</Field>}
      <Field label="Trecho original selecionado">{({ id }) => <Textarea id={id} readOnly rows={5} value={original.excerpt} />}</Field>
      {original.after && <Field label="Contexto posterior">{({ id }) => <Textarea id={id} readOnly rows={3} value={original.after} />}</Field>}
      <DescriptionList items={[{ label: 'Material original', value: context.material.title },
        { label: 'Tipo', value: evidence.kind === 'citation' ? 'Citação' : 'Estatística' },
        { label: 'Versão original', value: original.ref.sourceVersion }, { label: 'Revisão selecionada', value: evidence.revision },
        ...(evidence.kind === 'citation' ? [{ label: 'Autoria', value: person(evidence.personId) }]
          : [{ label: 'Indicador', value: evidence.indicator }, { label: 'Valor literal', value: evidence.value.raw }, { label: 'Unidade', value: evidence.unit },
            { label: 'Período', value: evidence.period?.label }, { label: 'Geografia', value: evidence.geography }, { label: 'População', value: evidence.population },
            { label: 'Ressalva', value: evidence.qualifier }, { label: 'Instituição emissora', value: evidence.issuingInstitution }]),
        { label: 'Publicação original', value: evidence.metadata.publishedOn }, { label: 'Data da declaração', value: evidence.metadata.recordedOn }]} />
    </Section>
    <Section title="Decisão usada na seleção">
      {context.decisionRestricted ? <Alert tone="warning" title="A decisão editorial contém fontes restritas à sua conta" />
        : decision ? <>
          <DescriptionList items={[{ label: 'Decisão', value: ({ accept: 'Aceita', reject: 'Rejeitada', request_revision: 'Revisão solicitada' })[decision.action] },
            { label: 'Revisada por', value: person(decision.personId) }, { label: 'Data da decisão', value: new Date(decision.at).toLocaleString('pt-BR') },
            { label: 'Motivo', value: decision.reason }]} />
          {decision.supports.map((support, index) => <SelectedSupport key={index} support={support} label={`Fonte da decisão ${index + 1}`} />)}
        </> : <Badge>Sem decisão editorial nesta seleção</Badge>}
    </Section>
    <Section title="Checagem usada na seleção">
      {context.checkRestricted ? <Alert tone="warning" title="A checagem contém fontes restritas à sua conta" />
        : check ? <>
          <DescriptionList items={[{ label: 'Revisão da checagem', value: check.revision }, { label: 'Resultado', value: VERDICT_LABELS[check.verdict] },
            { label: 'Data da checagem', value: new Date(check.checkedAt).toLocaleString('pt-BR') },
            { label: 'Confiança factual', value: check.confidence === null ? 'Não calibrada' : `${check.confidence}%` },
            { label: 'Força editorial', value: check.strength ? `${check.strength.score} — ${check.strength.reason}` : 'Não calculada' }]} />
          {check.claims.map((claim, index) => <Section key={index} titleAs="h3" title={`Afirmação ${index + 1}`}>
            <Textarea aria-label={`Afirmação selecionada ${index + 1}`} readOnly rows={3} value={claim.text} />
            <DescriptionList items={[{ label: 'Tipo', value: CLAIM_KIND_LABELS[claim.kind] }, { label: 'Resultado', value: claim.verdict ? CLAIM_VERDICT_LABELS[claim.verdict] : 'Não checável' }, { label: 'Motivo', value: claim.reason }]} />
          </Section>)}
          {check.supports.map((support, index) => <SelectedSupport key={index} support={support.evidence}
            label={`${support.relation === 'contradicts' ? 'Contraponto' : support.relation === 'related' ? 'Contexto relacionado' : 'Fonte da checagem'} ${index + 1}`} />)}
        </> : <Badge>Sem checagem nesta seleção</Badge>}
    </Section>
    <Section title="Registro da seleção">
      <DescriptionList items={[{ label: 'Versão da coleção', value: context.collection.sourceVersion }, { label: 'Revisão da seleção', value: selection.revision },
        { label: 'Selecionada por', value: person(selection.updatedBy) }, { label: 'Data da seleção', value: new Date(selection.updatedAt).toLocaleString('pt-BR') },
        { label: 'Política selecionada', value: `Revisão ${context.policy.revision}` }, { label: 'Modo da política', value: context.policy.mode === 'calibrated' ? 'Calibrada' : 'Revisão editorial obrigatória' }]} />
      <Field label="Hash do original">{({ id }) => <Textarea id={id} readOnly rows={2} value={original.ref.hash} />}</Field>
      {context.binding.selected.discovery && <Section titleAs="h3" title="Busca original da evidência"><MemoryDiscoveryDetails discovery={context.binding.selected.discovery} material={context.material} /></Section>}
    </Section>
  </Panel>;
}

function SelectedSupport({ support, label }: { support: MemorySupport; label: string }) {
  return <Section titleAs="h3" title={label}>
    {support.kind === 'external' ? <TextLink href={support.url} target="_blank" rel="noreferrer">{support.title}</TextLink>
      : <DescriptionList items={[{ label: 'Origem no acervo', value: support.primaryOrigin }]} />}
    {support.originStatus === 'unverified' && <Badge tone="amber">Origem original não confirmada</Badge>}
    <Textarea aria-label={`Trecho de ${label.toLocaleLowerCase('pt-BR')}`} readOnly rows={3} value={support.excerpt} />
  </Section>;
}
