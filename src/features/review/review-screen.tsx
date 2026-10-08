'use client';

import { Suspense, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Badge,
  ButtonLink,
  Disclosure,
  EmptyState,
  ErrorState,
  FilterBar,
  LinkButton,
  List,
  ListItem,
  LoadingSwap,
  NextAction,
  PageStack,
  ReadingColumn,
  Segmented,
  SkeletonText,
  Switch,
  toast,
  type MenuSection,
  type Tone,
} from '@content-ventures/design-system/v3';
import { GitCompareArrows, History as HistoryIcon, PenLine } from '@content-ventures/design-system/v3/icons';
import { freshnessMessage, PIECE_LABELS, type DecisionAnchor, type PieceKind, type ProductionId } from '@/domain';
import { blocked, type Guard, type ProductionDetail } from '@/ports';
import { pieceKind as pieceKindEntry } from '@/registries';
import { useCommands, usePeople, useReview } from '@/state';
import { dueOf, noteLine } from '@/features/approval/approvals-model';
import { useProductionFrame } from '@/features/production/production-frame';
import { ApprovalBanner } from '@/ui/approval-banner';
import { approvalNoticeKind, taskCardMeta, taskCardTitle, type ApprovedNext } from '@/ui/approval-copy';
import { ChecksList } from '@/ui/checks-list';
import { iconFor } from '@/ui/icons';
import { PersonAvatar } from '@/ui/person-avatar';
import { approvalsHref, pieceHref } from '@/ui/routes';
import { useCommandGroup } from '@/ui/shell';
import { StatusBadge } from '@/ui/status-badge';
import { useNow } from '@/ui/time';
import { usePhone } from '@/ui/use-phone';
import { ApproveDialog } from './approve-dialog';
import { ArticleReading } from './article-reading';
import { CarouselSlides } from './carousel-slides';
import { DecisionBar } from './decision-bar';
import { ReturnDialog } from './return-dialog';
import { ReviewChanges } from './review-changes';
import { ReviewHistory } from './review-history';
import {
  addAnchors,
  anchorKey,
  approveLabel,
  checksSummary,
  decisionFactList,
  finalLabel,
  hasAiText,
  originBody,
  type ChecksSummary,
  type ReviewMode,
} from './review-model';
import { ReviewSurface } from './review-surface';
import { useReviewView } from './use-review-view';

/**
 * Revisão guiada (`/productions/[id]/[piece]/review`, COPY §4): who was asked reads the exact text
 * under review and decides in one place. Top to bottom: the task card ("Juliana Prates pediu sua
 * aprovação", with the recado and the due date) or the approval notice, the view switch ("O que
 * mudou" | "Texto final", opening on the changes when there was a previous send), the checks in one
 * line, and the document; the decision bar stays in view. One surface for the article and the
 * carousel; whoever cannot decide reads the same document with no bar. Approving freezes the
 * decision on that version's hash; asking for adjustments needs a note and may point at passages.
 */
export function ReviewScreen({ productionId, pieceKind }: { productionId: ProductionId; pieceKind: PieceKind }) {
  return (
    <Suspense fallback={<ReviewSurface header={{}} mainLabel={mainLabelOf(pieceKind)}>{bodySkeleton(pieceKind)}</ReviewSurface>}>
      <ReviewRoute productionId={productionId} pieceKind={pieceKind} />
    </Suspense>
  );
}

const BODY_SKELETON = <SkeletonText lines={12} lineHeight={28} label="Carregando o texto" />;

/** While the text loads: an article's lines already sit in the text's column (no jump). */
function bodySkeleton(kind: PieceKind): ReactNode {
  return kind === 'article' ? <ReadingColumn>{BODY_SKELETON}</ReadingColumn> : BODY_SKELETON;
}

function mainLabelOf(kind: PieceKind): string {
  return kind === 'carousel' ? 'Slides' : 'Texto';
}

const CHECKS_TONE: Readonly<Record<ChecksSummary['level'], Tone>> = { ok: 'teal', warning: 'amber', missing: 'red' };

/** What the next stage of the journey is, for the "approved" notice. */
function approvedNextOf(kind: PieceKind, production: ProductionDetail | undefined): ApprovedNext {
  return kind === 'article' && production?.plan.includes('carousel') ? 'carousel' : 'delivery';
}

type AnchorState = { versionId: string | undefined; list: DecisionAnchor[] };
type Decided = { versionId: string; decision: 'approved' | 'changes_requested'; requesterName: string };

function ReviewRoute({ productionId, pieceKind }: { productionId: ProductionId; pieceKind: PieceKind }) {
  const router = useRouter();
  const phone = usePhone();
  const now = useNow();
  const commands = useCommands();
  const { production } = useProductionFrame();
  const detail = production.data;
  const piece = detail?.pieces.find((candidate) => candidate.kind === pieceKind);
  const review = useReview(piece?.id);
  const people = usePeople();
  const data = review.status === 'ready' ? review.data : undefined;
  const approval = data?.approval;
  const version = data?.version;
  const view = useReviewView({ hasPrevious: Boolean(data?.previous), defaultView: data?.defaultView ?? 'final' });

  const [seenHash, setSeenHash] = useState<string | undefined>();
  const [anchorState, setAnchorState] = useState<AnchorState>({ versionId: undefined, list: [] });
  const [note, setNote] = useState('');
  const [dialog, setDialog] = useState<'approve' | 'return' | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [origin, setOrigin] = useState(false);
  const [decidedHere, setDecidedHere] = useState<Decided | null>(null);

  // The version the reviewer opened is the one they decide on; a newer one must be acknowledged.
  if (data && seenHash === undefined) setSeenHash(data.version.hash);
  // Pointed passages belong to one version.
  if (data && anchorState.versionId !== data.version.id) setAnchorState({ versionId: data.version.id, list: [] });

  const label = PIECE_LABELS[pieceKind];
  const studioHref = pieceHref(productionId, pieceKind);
  const anchors = anchorState.list;
  const setAnchors = (list: DecisionAnchor[]) => setAnchorState((state) => ({ ...state, list }));

  // The articles' text with the AI's mark on every block it wrote (the "origin" switch), or as is.
  const articleBody = version?.body.type === 'article' ? version.body : undefined;
  const shownBody = useMemo(() => (articleBody && origin ? originBody(articleBody) : articleBody), [articleBody, origin]);

  const hashOk = !data || !seenHash || seenHash === data.version.hash;
  const mismatch: Guard = blocked('hash_mismatch', 'A versão na tela é diferente da versão enviada para aprovação.');
  const approveGuard = data ? (hashOk ? data.guards.approve : mismatch) : mismatch;
  const returnGuard = data ? (hashOk ? data.guards.requestChanges : mismatch) : mismatch;
  const decided = decidedHere && decidedHere.versionId === version?.id ? decidedHere : null;
  const canDecide = Boolean(approval?.viewer.canDecide);
  // The bar is for whoever decides, until the text has a decision (here or recorded).
  const deciding = Boolean(data && version && canDecide && !decided && !version.decision);
  const noticeKind = approval ? approvalNoticeKind(approval, Boolean(decided)) : null;
  const request = approval?.request;
  const requesterName = request?.requester?.name ?? data?.pendingReview?.requester?.name ?? '';
  const canPoint = deciding && returnGuard.allowed && pieceKind === 'article';
  const mode: ReviewMode = view.mode;
  const characters = version?.characters;
  const size = detail?.brief.size;
  const checks = data
    ? checksSummary({ kind: pieceKind, checks: data.checks, ...(size ? { size } : {}), ...(characters !== undefined ? { characters } : {}) })
    : undefined;

  async function approve(noteText: string): Promise<string | null> {
    if (!data) return null;
    const text = noteText.trim();
    const result = await commands.production.decide({
      pieceId: data.pieceId,
      subject: data.version.ref,
      decision: 'approved',
      ...(text ? { note: text } : {}),
      displayedHash: data.version.hash,
    });
    if (!result.ok) return result.refusal.message;
    setDecidedHere({ versionId: data.version.id, decision: 'approved', requesterName });
    setDialog(null);
    toast('Aprovado');
    return null;
  }

  async function sendReturn(): Promise<string | null> {
    if (!data) return null;
    const result = await commands.production.decide({
      pieceId: data.pieceId,
      subject: data.version.ref,
      decision: 'changes_requested',
      note: note.trim(),
      anchors,
      displayedHash: data.version.hash,
    });
    if (!result.ok) return result.refusal.message;
    setDecidedHere({ versionId: data.version.id, decision: 'changes_requested', requesterName });
    setDialog(null);
    setNote('');
    setAnchors([]);
    toast('Ajustes pedidos');
    return null;
  }

  useCommandGroup(
    data && deciding
      ? {
          label: 'Revisão',
          items: [
            ...(approveGuard.allowed ? [{ id: 'review.approve', label: approveLabel(pieceKind), onSelect: () => setDialog('approve') }] : []),
            ...(returnGuard.allowed ? [{ id: 'review.return', label: 'Pedir ajustes', onSelect: () => setDialog('return') }] : []),
            ...(data.previous
              ? [
                  mode === 'changes'
                    ? { id: 'review.final', label: pieceKind === 'carousel' ? 'Ver slides' : 'Ver texto final', onSelect: () => view.setMode('final') }
                    : { id: 'review.changes', label: 'Ver o que mudou', onSelect: () => view.setMode('changes') },
                ]
              : []),
          ],
        }
      : null,
  );

  // ── Header line: "← Aprovações" for whoever decides, the status in the decider's words, the ⋯ ──
  const menu: MenuSection[] = [
    {
      items: [
        { label: 'Abrir no estúdio', icon: PenLine, onSelect: () => router.push(studioHref) },
        ...(data ? [{ label: 'Histórico de versões', icon: HistoryIcon, onSelect: () => setHistoryOpen(true) }] : []),
      ],
    },
  ];

  // ── Task card or approval notice (one of them, at the top of the text's column) ──
  let top: ReactNode = null;
  if (data && approval) {
    if (noticeKind === 'awaiting_you' && request) {
      const due = dueOf(request.dueOn, now);
      top = (
        <List label="Pedido de aprovação">
          <ListItem
            leading={<PersonAvatar person={request.requester} name={request.requester?.name} size="sm" decorative />}
            title={taskCardTitle(request.requester?.name)}
            description={noteLine(request.note, 200)}
            meta={taskCardMeta(request.requestedAt, now, request.round)}
            trailing={due ? <NextAction label={due.text} due={due.tone} /> : undefined}
          />
        </List>
      );
    } else {
      top = (
        <ApprovalBanner
          approval={approval}
          approvedNext={approvedNextOf(pieceKind, detail)}
          {...(decided ? { decided: { decision: decided.decision, requesterName: decided.requesterName, ...(data.nextInQueue ? { next: data.nextInQueue } : {}) } } : {})}
        />
      );
    }
  }

  // ── Body ──
  let body: ReactNode;
  if (production.status === 'ready' && !piece) {
    body = (
      <EmptyState
        icon={iconFor(pieceKindEntry(pieceKind)?.icon ?? 'FileText')}
        title={`${label} ainda não começou`}
        size="page"
        actions={
          <ButtonLink href={studioHref} variant="primary">
            Abrir {label.toLowerCase()}
          </ButtonLink>
        }
      />
    );
  } else if (review.status === 'error') {
    body =
      review.error?.code === 'not_found' ? (
        <EmptyState
          icon={GitCompareArrows}
          title="Nada para revisar"
          size="page"
          actions={
            <ButtonLink href={studioHref} variant="primary">
              Abrir estúdio
            </ButtonLink>
          }
        />
      ) : (
        <ErrorState title="Não foi possível abrir a revisão" onRetry={review.retry} size="page" />
      );
  } else {
    const Column = pieceKind === 'article' ? ReadingColumn : PageStack;
    const staleMessage = data && data.freshness.state === 'stale' ? freshnessMessage(data.freshness, 'artigo') : undefined;
    const showOrigin = Boolean(articleBody && mode === 'final' && hasAiText(articleBody));
    body = (
      <LoadingSwap loading={!data} skeleton={bodySkeleton(pieceKind)} label="Carregando o texto">
        {data && version ? (
          <Column>
            {hashOk ? null : (
              <Alert
                tone="info"
                title="O texto mudou desde que você abriu"
                action={<LinkButton onClick={() => setSeenHash(data.version.hash)}>Revisar o texto novo</LinkButton>}
              />
            )}
            {top}
            {staleMessage ? <Alert tone="warning" title={staleMessage} /> : null}
            {data.previous || showOrigin ? (
              <FilterBar
                filters={false}
                tabs={
                  data.previous ? (
                    <Segmented<ReviewMode>
                      label="Ver"
                      size="sm"
                      full={phone}
                      value={mode}
                      onChange={view.setMode}
                      options={[
                        { value: 'changes', label: 'O que mudou' },
                        { value: 'final', label: finalLabel(pieceKind) },
                      ]}
                    />
                  ) : undefined
                }
                actions={showOrigin ? <Switch size="sm" label="Ver origem do texto" checked={origin} onCheckedChange={setOrigin} /> : undefined}
              />
            ) : null}
            {checks ? (
              <Disclosure
                variant="plain"
                headingLevel="h2"
                summary={
                  <Badge tone={CHECKS_TONE[checks.level]} variant="text" size="sm">
                    {checks.text}
                  </Badge>
                }
              >
                <ChecksList checks={data.checks} headingLevel="h3" />
              </Disclosure>
            ) : null}
            {mode === 'changes' && data.previous ? (
              <ReviewChanges pieceId={data.pieceId} from={data.previous.version.id} to={version.id} />
            ) : version.body.type === 'article' && shownBody ? (
              <ArticleReading
                body={shownBody}
                label="Texto do artigo"
                anchors={anchors}
                recorded={data.decisions.find((decision) => decision.id === version.decision?.id)?.anchors}
                canPoint={canPoint}
                onPoint={(added) => setAnchors(addAnchors(shownBody, anchors, added))}
                onReturnWith={(added) => {
                  setAnchors(addAnchors(shownBody, anchors, added));
                  setDialog('return');
                }}
              />
            ) : version.body.type === 'carousel' ? (
              <CarouselSlides body={version.body} hash={version.hash} versionNumber={version.number} articleCover={version.articleCover?.assetId} />
            ) : null}
          </Column>
        ) : null}
      </LoadingSwap>
    );
  }

  // ── Decision bar ──
  const footer: ReactNode =
    data && version && deciding ? (
      <DecisionBar
        kind={pieceKind}
        facts={decisionFactList({
          kind: pieceKind,
          requesterName,
          ...(version.body.type === 'carousel' ? { slides: version.body.slides.length } : { characters: version.characters }),
          ...(size ? { size } : {}),
        })}
        approve={approveGuard}
        requestChanges={returnGuard}
        onApprove={() => setDialog('approve')}
        onReturn={() => setDialog('return')}
      />
    ) : undefined;

  return (
    <>
      <ReviewSurface
        header={{
          ...(canDecide ? { back: { label: 'Aprovações', href: approvalsHref() } } : {}),
          ...(noticeKind === 'awaiting_you' && data ? { status: <StatusBadge kind="piece" status={data.status} label="Aguardando sua aprovação" /> } : {}),
          menu,
        }}
        mainLabel={mainLabelOf(pieceKind)}
        footer={footer}
      >
        {body}
      </ReviewSurface>
      {data && version ? (
        <>
          <ApproveDialog open={dialog === 'approve'} onClose={() => setDialog(null)} kind={pieceKind} onSubmit={approve} />
          <ReturnDialog
            open={dialog === 'return'}
            onClose={() => setDialog(null)}
            requesterName={requesterName}
            note={note}
            onNoteChange={setNote}
            anchors={anchors}
            onRemoveAnchor={(anchor) => setAnchors(anchors.filter((candidate) => anchorKey(candidate) !== anchorKey(anchor)))}
            onSubmit={sendReturn}
          />
          <ReviewHistory
            open={historyOpen}
            onClose={() => setHistoryOpen(false)}
            kind={pieceKind}
            versions={piece?.versions ?? []}
            approval={data.approval}
            people={people.data}
          />
        </>
      ) : null}
    </>
  );
}
