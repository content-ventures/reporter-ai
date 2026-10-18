'use client';

import { Fragment } from 'react';
import {
  AgentTrace,
  Alert,
  Grid,
  LinkButton,
  List,
  ListItem,
  Panel,
  Prose,
  Section,
  SourceChip,
} from '@content-ventures/design-system/v3';
import type { AgentTraceStep } from '@content-ventures/design-system/v3';
import type { ArchiveAnswer, ArchiveArticle } from '@/domain/hard-news';
import { formatDate, plural } from '@/ui/format';
import { addressOf, answerPieces } from './archive-model';

/** Keeps a citation marker on the line of the word it follows. */
const WORD_JOINER = '⁠';

type CitedAnswer = Extract<ArchiveAnswer, { kind: 'answer' }>;

/** Where a search's answer is: the AI looking through what it read, then writing. */
export type AskStep = 'search' | 'write';

/**
 * The search's answer, above the articles found: the AI's steps while it reads, then the answer
 * citing only published passages (REQ-2.12), or a plain "nothing found".
 */
export function AnswerPanel({ question, step, answer, failed, archive, unreadMatches, onRetry, onOpenArticle }: {
  question: string;
  step?: AskStep;
  answer?: ArchiveAnswer;
  failed: boolean;
  archive: readonly ArchiveArticle[];
  /** Articles about the search the AI has not read (they show below, with their note). */
  unreadMatches: number;
  onRetry: () => void;
  onOpenArticle: (id: string) => void;
}) {
  const read = archive.filter((article) => article.index === 'indexed').length;
  const steps: AgentTraceStep[] = [
    { id: 'search', label: `Procurando nas ${plural(read, 'matéria lida', 'matérias lidas')}`, state: step === 'search' ? 'current' : 'done' },
    { id: 'write', label: 'Escrevendo a resposta com as fontes', state: step === 'write' ? 'current' : 'upcoming' },
  ];
  const meta = answer?.kind === 'answer' ? `Resposta da IA · ${plural(answer.passages.length, 'fonte', 'fontes')}` : undefined;
  return (
    <Panel label="Resposta do acervo" padding="lg">
      <Section title={question} titleAs="h2" meta={step ? undefined : meta}>
        {step ? (
          <AgentTrace label="Lendo o acervo" steps={steps} collapsible={false} />
        ) : failed ? (
          <Alert tone="danger" title="Não foi possível consultar o acervo." action={<LinkButton onClick={onRetry}>Tentar de novo</LinkButton>} />
        ) : answer ? (
          <ArchiveAnswerView answer={answer} archive={archive} unreadMatches={unreadMatches} onOpenArticle={onOpenArticle} />
        ) : null}
      </Section>
    </Panel>
  );
}

/**
 * The archive's answer (REQ-2.12): the text with a numbered marker after each claim, beside every
 * source it cites with the article, its date and address. "Nothing found" says so plainly and that
 * it is no proof the fact did not happen.
 */
function ArchiveAnswerView({ answer, archive, unreadMatches, onOpenArticle }: {
  answer: ArchiveAnswer;
  archive: readonly ArchiveArticle[];
  unreadMatches: number;
  onOpenArticle: (id: string) => void;
}) {
  if (answer.kind === 'none') {
    return (
      <Alert tone="info" title={unreadMatches > 0 ? 'Nenhuma matéria lida pela IA trata disso.' : 'O acervo não tem matérias sobre isso.'}>
        Isso não prova que o fato não aconteceu.
      </Alert>
    );
  }
  return (
    <Grid columns="1:1" collapseBelow={1024} align="start">
      <AnswerText answer={answer} archive={archive} onOpenArticle={onOpenArticle} />
      <List label="Fontes da resposta" framed={false} bleed>
        {answer.passages.map((passage, index) => {
          const article = archive.find((item) => item.id === passage.articleId);
          return (
            <ListItem
              key={`${passage.articleId}-${index}`}
              leading={<SourceChip variant="inline" kind="archive" index={index + 1} label={article?.section ?? 'Acervo'} />}
              title={article?.title ?? 'Matéria fora do acervo'}
              titleLines={2}
              description={article ? `${formatDate(article.publishedAt)} · ${addressOf(article.url)}` : undefined}
              onClick={article ? () => onOpenArticle(article.id) : undefined}
            />
          );
        })}
      </List>
    </Grid>
  );
}

function AnswerText({ answer, archive, onOpenArticle }: { answer: CitedAnswer; archive: readonly ArchiveArticle[]; onOpenArticle: (id: string) => void }) {
  return (
    <Prose variant="read" size="sm" measure="article" align="start" label="Resposta do acervo">
      {answerPieces(answer).map((piece, pieceIndex) => (
        <Fragment key={pieceIndex}>
          {piece.cites.length ? `${piece.text}${WORD_JOINER}` : piece.text}
          {piece.cites.map((cite) => {
            const passage = answer.passages[cite - 1];
            const article = archive.find((item) => item.id === passage?.articleId);
            return (
              <SourceChip
                key={cite}
                variant="inline"
                kind="archive"
                index={cite}
                label={article?.title ?? 'Matéria do acervo'}
                meta={article ? formatDate(article.publishedAt) : undefined}
                preview={passage ? `“${passage.text}”` : undefined}
                onOpen={article ? () => onOpenArticle(article.id) : undefined}
                openLabel="Abrir matéria"
              />
            );
          })}
        </Fragment>
      ))}
    </Prose>
  );
}
