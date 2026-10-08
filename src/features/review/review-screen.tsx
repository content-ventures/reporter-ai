'use client';

import { Suspense, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert,
  ButtonLink,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LinkButton,
  List,
  ListItem,
  LoadingSwap,
  MetaList,
  PageStack,
  Seal,
  Segmented,
  Select,
  Skeleton,
  SkeletonText,
  TextLink,
  toast,
} from '@content-ventures/design-system/v3';
import { GitCompareArrows } from '@content-ventures/design-system/v3/icons';
import {
  freshnessMessage,
  PIECE_LABELS,
  type DecisionAnchor,
  type PieceKind,
  type ProductionId,
} from '@/domain';
import { blocked, type Guard, type ProductionDetail, type ReviewView } from '@/ports';
import { pieceKind as pieceKindEntry } from '@/registries';
import { useCommands, usePeople, useReview } from '@/state';
import { useProductionFrame } from '@/features/production/production-frame';
import { useCommandGroup } from '@/ui/shell';
import { plural } from '@/ui/format';
import { iconFor } from '@/ui/icons';
import { deliveryHref, pieceHref } from '@/ui/routes';
import { StatusBadge } from '@/ui/status-badge';
import { RelativeTime } from '@/ui/time';
import { ArticleReading, type BlockFocus } from './article-reading';
import { CarouselSlides } from './carousel-slides';
import { DecisionBar } from './decision-bar';
import { ReviewAside } from './review-aside';
import { ReviewChanges } from './review-changes';
import { personName } from './review-history';
import { addAnchors, anchorKey, checkWarnings, compareOptions, versionStatus, type CompareOption } from './review-model';
import { ReviewSurface } from './review-surface';
import { ReturnDialog } from './return-dialog';
import { useReviewView } from './use-review-view';

/**
 * Revisão (`/productions/[id]/[piece]/review`, PLAN §3.6, REQ-1.3/1.6/T.6): the gate over the
 * EXACT version under review. One surface for the article and the carousel; the body is the
 * subject's own (prose, diff or rendered slides). Approving freezes the decision on that version
 * hash and unlocks the next stage; returning needs a note and may point at passages.
 */
export function ReviewScreen({ productionId, pieceKind }: { productionId: ProductionId; pieceKind: PieceKind }) {
  return (
    <Suspense fallback={<ReviewSurface status={STATUS_SKELETON} mainLabel={mainLabelOf(pieceKind)}>{BODY_SKELETON}</ReviewSurface>}>
      <ReviewRoute productionId={productionId} pieceKind={pieceKind} />
    </Suspense>
  );
}

const BODY_SKELETON = <SkeletonText lines={12} lineHeight={28} label="Carregando a versão" />;

const STUDIO_FIXABLE = new Set(['run_in_progress', 'suggestion_pending', 'blocking_checks']);

function mainLabelOf(kind: PieceKind): string {
  return kind === 'carousel' ? 'Slides' : 'Texto';
}

/** The version's status while it loads: same place and height as the badge (no jump). */
const STATUS_SKELETON = <Skeleton width={150} height={22} />;

/** Where the journey goes once this piece is approved. */
function nextStep(kind: PieceKind, production: ProductionDetail): { label: string; href: string } {
  if (kind === 'article' && production.plan.includes('carousel')) {
    const carousel = production.pieces.find((piece) => piece.kind === 'carousel');
    if (carousel?.status !== 'approved') {
      return { label: carousel && carousel.versions.length > 0 ? 'Abrir carrossel' : 'Gerar carrossel', href: pieceHref(production.id, 'carousel') };
    }
  }
  return { label: 'Ir para entrega', href: deliveryHref(production.id) };
}

function consequence(kind: PieceKind, production: ProductionDetail): string {
  return kind === 'article' && production.plan.includes('carousel') ? 'O carrossel usará esta versão.' : 'A entrega usará esta versão.';
}

type AnchorState = { versionId: string | undefined; list: DecisionAnchor[] };

function ReviewRoute({ productionId, pieceKind }: { productionId: ProductionId; pieceKind: PieceKind }) {
  const router = useRouter();
  const commands = useCommands();
  const { production } = useProductionFrame();
  const detail = production.data;
  const piece = detail?.pieces.find((candidate) => candidate.kind === pieceKind);
  const review = useReview(piece?.id);
  const people = usePeople();
  const data = review.status === 'ready' ? review.data : undefined;

  const options = useMemo<CompareOption[]>(() => (data ? compareOptions(data) : []), [data]);
  const view = useReviewView(options);

  const [seenHash, setSeenHash] = useState<string | undefined>();
  const [anchorState, setAnchorState] = useState<AnchorState>({ versionId: undefined, list: [] });
  const [note, setNote] = useState('');
  const [dialog, setDialog] = useState<'approve' | 'return' | null>(null);
  const [sealed, setSealed] = useState<string | null>(null);
  const [lit, setLit] = useState<readonly string[]>([]);
  const [focus, setFocus] = useState<BlockFocus | null>(null);

  // The version the reviewer opened is the one they decide on; a newer one must be acknowledged.
  if (data && seenHash === undefined) setSeenHash(data.version.hash);
  // Pointed passages belong to one version.
  if (data && anchorState.versionId !== data.version.id) setAnchorState({ versionId: data.version.id, list: [] });

  const label = PIECE_LABELS[pieceKind];
  const mainLabel = mainLabelOf(pieceKind);
  const studioHref = pieceHref(productionId, pieceKind);
  const anchors = anchorState.list;
  const setAnchors = (list: DecisionAnchor[]) => setAnchorState((state) => ({ ...state, list }));

  const version = data?.version;
  const hashOk = !data || !seenHash || seenHash === data.version.hash;
  const mismatch: Guard = blocked('hash_mismatch', 'A versão na tela é diferente da versão enviada para aprovação.');
  const approveGuard = data ? (hashOk ? data.guards.approve : mismatch) : mismatch;
  const returnGuard = data ? (hashOk ? data.guards.requestChanges : mismatch) : mismatch;
  const decided = version?.decision?.kind;
  const state: 'open' | 'approved' | 'returned' = decided === 'approved' ? 'approved' : decided === 'changes_requested' || decided === 'rejected' ? 'returned' : 'open';
  const next = detail ? nextStep(pieceKind, detail) : undefined;
  const warnings = data ? checkWarnings(data.checks) : [];
  const canPoint = state === 'open' && returnGuard.allowed && pieceKind === 'article';
  // Why the decision is blocked, in the text column too (the bar's tooltip is not enough on a phone).
  const notice =
    data && state === 'open' && !approveGuard.allowed && approveGuard.code !== 'hash_mismatch' ? (
      <Alert
        tone="warning"
        title={approveGuard.reason}
        action={
          STUDIO_FIXABLE.has(approveGuard.code) ? (
            <TextLink href={studioHref} size="sm">
              Resolver no estúdio
            </TextLink>
          ) : undefined
        }
      />
    ) : null;

  async function approve() {
    if (!data) return;
    const result = await commands.production.decide({
      pieceId: data.pieceId,
      subject: data.version.ref,
      decision: 'approved',
      displayedHash: data.version.hash,
    });
    if (!result.ok) {
      toast(result.refusal.message, { tone: 'error' });
      return;
    }
    setSealed(data.version.id);
    toast(`Versão ${data.version.number} aprovada`, next ? { action: { label: next.label, onClick: () => router.push(next.href) } } : {});
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
    setDialog(null);
    setNote('');
    setAnchors([]);
    toast(`Versão ${data.version.number} devolvida com nota`);
    return null;
  }

  useCommandGroup(
    data && state === 'open'
      ? {
          label: 'Revisão',
          items: [
            ...(approveGuard.allowed ? [{ id: 'review.approve', label: `Aprovar versão ${data.version.number}`, onSelect: () => setDialog('approve') }] : []),
            ...(returnGuard.allowed ? [{ id: 'review.return', label: 'Devolver com nota', onSelect: () => setDialog('return') }] : []),
            ...(options.length > 0
              ? [
                  view.mode === 'changes'
                    ? { id: 'review.final', label: pieceKind === 'carousel' ? 'Ver slides' : 'Ver texto final', onSelect: () => view.setMode('final') }
                    : { id: 'review.changes', label: 'Ver alterações', onSelect: () => view.setMode('changes') },
                ]
              : []),
          ],
        }
      : null,
  );

  // ── Header line (B02): the version's status and the view switch sit in the production header;
  // "Revisão" is the last crumb of the trail. The version and its size open the decision bar.
  const status = data ? versionStatus(data) : undefined;
  const settled = (production.status === 'ready' && !piece) || review.status === 'error';
  const headerStatus = settled ? undefined : !data || !status ? STATUS_SKELETON : <StatusBadge kind="piece" status={status} />;
  const viewSwitch =
    data && options.length > 0 ? (
      <>
        <Segmented
          label="Ver"
          size="sm"
          value={view.mode}
          onChange={view.setMode}
          options={[
            { value: 'changes', label: 'Alterações' },
            { value: 'final', label: pieceKind === 'carousel' ? 'Slides' : 'Texto final' },
          ]}
        />
        {view.mode === 'changes' && view.option ? (
          <Select
            size="sm"
            label="Comparar com"
            value={view.option.target}
            onChange={(target) => view.setCompare(target === 'ai' ? 'ai' : 'approved')}
            options={options.map((option) => ({ value: option.target, label: option.label }))}
          />
        ) : null}
      </>
    ) : undefined;
  const versionFacts = version
    ? [version.label, version.body.type === 'carousel' ? plural(version.body.slides.length, 'slide', 'slides') : plural(version.words, 'palavra', 'palavras')]
    : [];

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
          title="Nenhuma versão para revisar"
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
    body = (
      <LoadingSwap loading={!data} skeleton={BODY_SKELETON} label="Carregando a versão">
        {data && version ? (
          <ReadyBody
            data={data}
            people={people.data}
            hashOk={hashOk}
            onAcknowledge={() => setSeenHash(data.version.hash)}
            sealed={sealed === version.id}
            notice={notice}
            content={
              view.mode === 'changes' && view.option ? (
                <ReviewChanges
                  pieceId={data.pieceId}
                  from={{ id: view.option.version.id, label: view.option.version.label }}
                  to={{ id: version.id, label: version.label }}
                />
              ) : version.body.type === 'article' ? (
                <ArticleReading
                  body={version.body}
                  label={`Texto da versão ${version.number}`}
                  anchors={anchors}
                  recorded={data.decisions.find((decision) => decision.id === version.decision?.id)?.anchors}
                  litBlockIds={lit}
                  focus={focus}
                  canPoint={canPoint}
                  onPoint={(added) => setAnchors(addAnchors(version.body.type === 'article' ? version.body : { blocks: [] }, anchors, added))}
                  onReturnWith={(added) => {
                    setAnchors(addAnchors(version.body.type === 'article' ? version.body : { blocks: [] }, anchors, added));
                    setDialog('return');
                  }}
                />
              ) : (
                <CarouselSlides body={version.body} hash={version.hash} versionNumber={version.number} articleCover={version.articleCover?.assetId} />
              )
            }
          />
        ) : null}
      </LoadingSwap>
    );
  }

  // ── Aside ──
  const aside =
    data && detail ? (
      <ReviewAside
        review={data}
        production={detail}
        versions={piece?.versions ?? []}
        people={people.data}
        onLight={setLit}
        onShow={(blockId) => {
          if (view.mode !== 'final') view.setMode('final');
          setLit([blockId]);
          setFocus({ blockId, nonce: Date.now() });
        }}
      />
    ) : !settled && (review.status === 'loading' || production.status === 'loading') ? (
      <SkeletonText lines={8} label="Carregando a checagem" />
    ) : undefined;

  // ── Footer ──
  let footer: ReactNode;
  if (data && version) {
    if (state === 'approved' && data.freshness.state === 'stale') {
      footer = <DecisionBar state="approved" next={{ label: `Atualizar ${label.toLowerCase()}`, href: studioHref }} start={<MetaList size="sm" items={versionFacts} />} />;
    } else if (state === 'approved') {
      footer = <DecisionBar state="approved" next={next} start={<MetaList size="sm" items={detail ? [...versionFacts, consequence(pieceKind, detail)] : versionFacts} />} />;
    } else if (state === 'returned') {
      footer = <DecisionBar state="returned" studioHref={studioHref} start={<MetaList size="sm" items={[...versionFacts, 'Aguardando uma nova versão']} />} />;
    } else {
      footer = (
        <DecisionBar
          state="open"
          versionNumber={version.number}
          approve={approveGuard}
          requestChanges={returnGuard}
          onApprove={() => setDialog('approve')}
          onReturn={() => setDialog('return')}
          start={<OpenFacts lead={versionFacts} review={data} people={people.data} anchors={anchors.length} onAnchors={() => setDialog('return')} />}
        />
      );
    }
  }

  return (
    <>
      <ReviewSurface status={headerStatus} view={viewSwitch} mainLabel={mainLabel} aside={aside} footer={footer}>
        {body}
      </ReviewSurface>
      {data && version ? (
        <>
          <ConfirmDialog
            open={dialog === 'approve'}
            onClose={() => setDialog(null)}
            title={`Aprovar a versão ${version.number}?`}
            description={detail ? consequence(pieceKind, detail) : undefined}
            confirmLabel={`Aprovar versão ${version.number}`}
            onConfirm={approve}
            extra={
              warnings.length > 0 ? (
                <Alert tone="warning" compact>
                  {`${plural(warnings.length, 'aviso', 'avisos')}: ${warnings.map((check) => check.label).join(' · ')}`}
                </Alert>
              ) : undefined
            }
          />
          <ReturnDialog
            open={dialog === 'return'}
            onClose={() => setDialog(null)}
            versionNumber={version.number}
            note={note}
            onNoteChange={setNote}
            anchors={anchors}
            onRemoveAnchor={(anchor) => setAnchors(anchors.filter((candidate) => anchorKey(candidate) !== anchorKey(anchor)))}
            body={version.body.type === 'article' ? version.body : undefined}
            onSubmit={sendReturn}
          />
        </>
      ) : null}
    </>
  );
}

function OpenFacts({
  lead,
  review,
  people,
  anchors,
  onAnchors,
}: {
  /** The version and its size ("v2 · 477 palavras"). */
  lead: readonly string[];
  review: ReviewView;
  people: Parameters<typeof personName>[0];
  anchors: number;
  onAnchors: () => void;
}) {
  const request = review.pendingReview?.subject.versionId === review.version.id ? review.pendingReview : undefined;
  const facts: ReactNode[] = request
    ? [...lead, `Enviada por ${request.requester?.name ?? personName(people, request.requestedBy)}`, <RelativeTime key="at" at={request.requestedAt} />]
    : [...lead, 'Não enviada para aprovação'];
  if (anchors > 0) {
    facts.push(
      <LinkButton key="anchors" onClick={onAnchors}>
        {plural(anchors, 'trecho apontado', 'trechos apontados')}
      </LinkButton>,
    );
  }
  return <MetaList size="sm" items={facts} />;
}

function ReadyBody({
  data,
  people,
  hashOk,
  onAcknowledge,
  sealed,
  notice,
  content,
}: {
  data: ReviewView;
  people: Parameters<typeof personName>[0];
  hashOk: boolean;
  onAcknowledge: () => void;
  sealed: boolean;
  notice: ReactNode;
  content: ReactNode;
}) {
  const { version } = data;
  const decision = version.decision ? data.decisions.find((entry) => entry.id === version.decision?.id) : undefined;
  const decider = decision ? (decision.decider?.name ?? personName(people, decision.by)) : undefined;
  const staleMessage = data.freshness.state === 'stale' ? freshnessMessage(data.freshness, 'artigo') : undefined;

  return (
    <PageStack>
      {hashOk ? null : (
        <Alert
          tone="info"
          title="A versão mudou desde que você abriu"
          action={<LinkButton onClick={onAcknowledge}>Revisar a versão {version.number}</LinkButton>}
        >
          Na tela agora: versão {version.number}.
        </Alert>
      )}
      {version.decision?.kind === 'approved' ? (
        <List label="Decisão" framed={false} dividers={false}>
          <ListItem
            leading={<Seal label="" size="lg" still={!sealed} />}
            title={`Versão ${version.number} aprovada`}
            description={
              <MetaList size="sm" items={[decider ?? 'Aprovada', <RelativeTime key="at" at={version.decision.at} />]} />
            }
          />
        </List>
      ) : null}
      {decision && decision.decision !== 'approved' ? (
        <Alert tone="attention" title={`Devolvida por ${decider ?? 'quem revisou'}`} meta={<RelativeTime at={decision.at} />}>
          {decision.note}
        </Alert>
      ) : null}
      {staleMessage ? <Alert tone="warning" title={staleMessage} /> : null}
      {notice}
      {content}
    </PageStack>
  );
}
