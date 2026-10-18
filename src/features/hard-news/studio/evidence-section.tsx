'use client';

import {
  Alert,
  Button,
  LinkButton,
  List,
  ListItem,
  MetaList,
  PageStack,
  Section,
  SourceChip,
  formatRelative,
} from '@content-ventures/design-system/v3';
import { CircleCheck } from '@content-ventures/design-system/v3/icons';
import { EVIDENCE_KIND_LABELS, EVIDENCE_STATE_LABELS } from '@/domain/hard-news';
import type { EvidenceState } from '@/domain/hard-news';
import { useStudio } from '@/features/studio/article/studio-context';
import { formatCount } from '@/ui/format';
import { DemoBadge } from '../demo-badge';
import { useHardNews } from '../state/hard-news-provider';
import type { DeskStudio } from './use-desk-studio';
import type { LocatedFlag } from './evidence-model';

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/**
 * F2.8 · claims the AI could not back with the accepted sources, lit in the text. Each one asks a
 * person: take the sources' wording ("Corrigir"), keep it after checking ("Conferida"), or take it
 * out. The decision is kept with who and when (REQ-2.8); the AI never decides alone.
 */
export function EvidenceSection({ desk }: { desk: DeskStudio }) {
  const pending = desk.flags.filter((flag) => flag.state === 'open' && flag.range);
  const decided = desk.flags.filter((flag) => flag.state !== 'open' || flag.changed);
  if (desk.flags.length === 0) return null;
  return (
    <>
      {pending.length > 0 ? (
        <Section title="Evidências" titleAs="h3" meta={`${formatCount(pending.length)} a conferir`} metaTone="missing" action={<DemoBadge />}>
          <PageStack>
            {pending.map((flag) => <FlagToCheck key={flag.id} flag={flag} desk={desk} />)}
          </PageStack>
        </Section>
      ) : null}
      {decided.length > 0 ? (
        <Section title={pending.length > 0 ? 'Evidências decididas' : 'Evidências'} titleAs="h3" meta={formatCount(decided.length)} action={pending.length > 0 ? undefined : <DemoBadge />}>
          <List label="Evidências decididas" framed={false} bleed>
            {decided.map((flag) => <DecidedFlag key={flag.id} flag={flag} productionId={desk.dossier.productionId} />)}
          </List>
        </Section>
      ) : null}
    </>
  );
}

function FlagToCheck({ flag, desk }: { flag: LocatedFlag; desk: DeskStudio }) {
  const studio = useStudio();
  const { actions } = useHardNews();
  const source = flag.sourceId ? desk.dossier.sources.find((item) => item.id === flag.sourceId) : undefined;
  const productionId = desk.dossier.productionId;
  const decide = (state: EvidenceState) => actions.decideFlag(productionId, flag.id, state);
  const range = flag.range;
  const editable = studio.canEdit && !studio.readOnly && !studio.locked;
  return (
    <Alert
      tone="warning"
      role="none"
      title={(
        <LinkButton tone="inherit" size="inherit" onClick={() => range && studio.actions.focusRange(range)}>
          {`“${clip(flag.claim, 110)}”`}
        </LinkButton>
      )}
      action={editable ? (
        flag.fix ? (
          <LinkButton onClick={() => { if (range) studio.actions.useSourceText(range, flag.fix ?? flag.claim); decide('fixed'); }}>Corrigir</LinkButton>
        ) : (
          <LinkButton onClick={() => decide('confirmed')}>Conferida</LinkButton>
        )
      ) : undefined}
    >
      <MetaList size="sm" items={[EVIDENCE_KIND_LABELS[flag.kind], flag.detail]} />
      <MetaList
        size="sm"
        items={[
          flag.fix ? `Sugestão: “${clip(flag.fix, 90)}”` : null,
          source ? (
            <SourceChip
              key="source"
              kind={source.kind === 'archive' ? 'archive' : 'url'}
              label={source.outlet}
              preview={`“${source.excerpt}”`}
              onOpen={() => window.open(source.url, '_blank', 'noopener')}
              openLabel="Abrir fonte"
            />
          ) : null,
        ]}
      />
      {editable ? (
        <MetaList
          size="sm"
          items={[
            flag.fix ? <LinkButton key="confirm" size="sm" onClick={() => decide('confirmed')}>Manter, conferida</LinkButton> : null,
            <LinkButton key="remove" size="sm" onClick={() => { if (range) studio.actions.useSourceText(range, ''); decide('removed'); }}>Remover frase</LinkButton>,
          ]}
        />
      ) : null}
    </Alert>
  );
}

function DecidedFlag({ flag, productionId }: { flag: LocatedFlag; productionId: string }) {
  const { actions } = useHardNews();
  const label = flag.changed ? 'Trecho alterado no texto' : flag.state === 'open' ? '' : EVIDENCE_STATE_LABELS[flag.state];
  const who = flag.decidedBy && flag.decidedAt ? `${flag.decidedBy} · ${formatRelative(new Date(flag.decidedAt))}` : undefined;
  return (
    <ListItem
      icon={CircleCheck}
      title={`“${clip(flag.claim, 80)}”`}
      description={<MetaList size="sm" items={[label, who]} />}
      actions={flag.state !== 'open' ? <Button variant="ghost" size="sm" onClick={() => actions.decideFlag(productionId, flag.id, 'open')}>Reabrir</Button> : undefined}
    />
  );
}
