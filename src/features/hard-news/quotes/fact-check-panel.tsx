'use client';

import { Badge, Button, DescriptionList, List, ListItem, MeterList, Panel, Section, Timeline, type TimelineEntry } from '@content-ventures/design-system/v3';
import { BadgeCheck } from '@content-ventures/design-system/v3/icons';
import { CLAIM_KIND_LABELS, DISPUTED_CEILING, SCORE_WEIGHTS, VERDICT_LABELS, checkable, effectiveClaims } from '@/domain/fact-check';
import type { CitationScore, FactCheck } from '@/domain/fact-check';
import type { BankQuote } from '@/domain/hard-news';
import { ClaimVerdictBadge, FactSourceChip, VerdictBadge } from './verdict-view';
import { rankQuote } from './quote-model';

const dateOf = (value: string) => new Date(value).toLocaleDateString('pt-BR');

/** The four parts of the score, each against its weight. */
function ScoreParts({ score, strengthReason }: { score: CitationScore; strengthReason: string }) {
  const parts = [
    { key: 'veracity', label: 'Veracidade', value: score.veracity, max: SCORE_WEIGHTS.veracity },
    { key: 'strength', label: 'Força editorial', value: score.strength, max: SCORE_WEIGHTS.strength, why: strengthReason },
    { key: 'attribution', label: 'Autoria e fonte', value: score.attribution, max: SCORE_WEIGHTS.attribution },
    { key: 'usage', label: 'Uso em matérias', value: score.usage, max: SCORE_WEIGHTS.usage },
  ];
  return (
    <MeterList
      label="Composição do score"
      shares={false}
      format={(value) => String(value)}
      items={parts.map((part) => ({ key: part.key, label: part.label, value: part.value, share: (part.value / part.max) * 100,
        caption: 'why' in part && part.why ? `de ${part.max} · ${part.why}` : `de ${part.max}`,
        color: 'neutral' as const }))}
    />
  );
}

function claimEntries(check: FactCheck): TimelineEntry[] {
  return effectiveClaims(check).map((claim, index) => {
    const verdict = checkable(claim.kind) ? claim.verdict ?? 'not_validated' : undefined;
    const reason = claim.overridden ? `Decisão do editor em ${dateOf(claim.overridden.at)}: ${claim.overridden.reason}` : claim.reason;
    return {
      id: `${index}`,
      title: claim.text,
      badge: verdict ? <ClaimVerdictBadge verdict={verdict} /> : <Badge tone="gray" variant="soft" size="sm">Não checável</Badge>,
      description: CLAIM_KIND_LABELS[claim.kind],
      ...(reason ? { quote: reason } : {}),
      ...(claim.sources.length ? { extra: <>{claim.sources.map((source) => <FactSourceChip key={source.url} source={source} />)}</> } : {}),
    };
  });
}

/**
 * The fact check inside the quote drawer: seal, score and its parts, each claim with its type,
 * verdict, reason and sources, the editor's correction, and the articles that used the quote.
 */
export function FactCheckPanel({ quote, canEdit, checking, busy, onCheck, onCorrect }: {
  quote: BankQuote; canEdit: boolean; checking: boolean;
  /** Another quote is being checked: one check runs at a time. */
  busy: boolean;
  onCheck: () => void;
  /** Opens the verdict dialog, which lives beside the drawer: a dialog inside it would close it on closing. */
  onCorrect: () => void;
}) {
  const { verdict, score } = rankQuote(quote);
  const check = quote.factCheck;
  const decidable = check ? check.claims.some((claim) => checkable(claim.kind)) : false;
  const history: TimelineEntry[] = check ? [{ id: check.checkedAt, title: VERDICT_LABELS[verdict], date: dateOf(check.checkedAt), dateTime: check.checkedAt, state: 'current' },
    ...check.history.map((entry) => ({ id: entry.checkedAt, title: VERDICT_LABELS[entry.verdict], date: dateOf(entry.checkedAt), dateTime: entry.checkedAt }))] : [];
  return (
    <>
      <Panel label="Checagem">
        <Section
          title="Checagem"
          {...(check ? { meta: `Checada em ${dateOf(check.checkedAt)}` } : {})}
          action={canEdit && quote.checkable !== false ? (
            <Button variant="secondary" size="sm" icon={BadgeCheck} loading={checking} disabled={busy && !checking} onClick={onCheck}>{check ? 'Checar de novo' : 'Checar'}</Button>
          ) : undefined}
        >
          <DescriptionList
            labelWidth={120}
            items={[
              { label: 'Veredito', value: <VerdictBadge verdict={verdict} /> },
              { label: 'Score', value: score ? `${score.total} de 100` : undefined },
              ...(score?.capped ? [{ label: 'Teto', value: `${DISPUTED_CEILING}: há afirmação contestada` }] : []),
            ]}
          />
          {score && check ? <ScoreParts score={score} strengthReason={check.strength.reason} /> : null}
        </Section>
      </Panel>
      {check ? (
        <Panel label="Afirmações">
          <Section
            title="Afirmações"
            action={canEdit && decidable ? (
              <Button variant="ghost" size="sm" disabled={checking} onClick={onCorrect}>Corrigir veredito</Button>
            ) : undefined}
          >
            <Timeline label="Afirmações da fala" variant="activity" items={claimEntries(check)} />
          </Section>
        </Panel>
      ) : null}
      {quote.usedIn?.length ? (
        <Panel label="Usos">
          <Section title="Usos" meta={`${quote.usedIn.length} ${quote.usedIn.length === 1 ? 'matéria' : 'matérias'}`}>
            <List label="Matérias que usaram a fala" framed={false} bleed>
              {quote.usedIn.map((use) => <ListItem key={use.productionId} title={use.title} meta={dateOf(use.at)} href={`/productions/${use.productionId}`} />)}
            </List>
          </Section>
        </Panel>
      ) : null}
      {history.length > 1 ? (
        <Panel label="Histórico da checagem">
          <Section title="Histórico">
            <Timeline label="Checagens da fala" variant="dots" items={history} />
          </Section>
        </Panel>
      ) : null}
    </>
  );
}
