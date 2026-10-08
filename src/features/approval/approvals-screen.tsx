'use client';

import { Suspense, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AccessState,
  Avatar,
  Button,
  ButtonLink,
  CardHeader,
  Chip,
  DataTable,
  EmptyState,
  ErrorState,
  FilterBar,
  List,
  ListItem,
  ListItemSkeleton,
  NextAction,
  PageHeader,
  PageStack,
  Skeleton,
  Tabs,
  VisuallyHidden,
  type Column,
  type TabItem,
} from '@content-ventures/design-system/v3';
import { BadgeCheck, CornerDownLeft, Inbox } from '@content-ventures/design-system/v3/icons';
import type { ApprovalItem, ApprovalsPage, ApprovalsTab } from '@/ports';
import { isNavItemVisible, NAV_ITEMS } from '@/registries';
import { useApprovals, useSession, type QueryState } from '@/state';
import { approvalsHref, approvalsTabOf, PRODUCTIONS_HREF, reviewHref } from '@/ui/routes';
import { useNow } from '@/ui/time';
import { usePhone } from '@/ui/use-phone';
import {
  APPROVALS_COLUMNS,
  APPROVALS_COPY,
  APPROVALS_EMPTY,
  APPROVALS_TABS,
  decidedLine,
  dueOf,
  itemKey,
  noteLine,
  phoneDescription,
  pieceMeta,
  senderLine,
} from './approvals-model';

/**
 * Aprovações (`/approvals`, D10, COPY §3): the queue of whoever decides at a gate. Three tabs in
 * the URL (`?aba=aprovadas|devolvidas`): "Para aprovar N" (the menu's count), "Aprovadas por mim"
 * and "Devolvidas". Each row says the piece and its size, who sent it and when, the recado and the
 * due date; its one verb ("Revisar" / "Abrir") opens the guided review, and so does a click on the
 * row. A table on desktop, one row per piece on a phone. Members who do not decide anywhere get
 * the restricted state (the menu does not show them the item).
 */

const APPROVALS_ITEM = NAV_ITEMS.find((item) => item.id === 'approvals');
const TAB_ICONS: Readonly<Record<ApprovalsTab, typeof Inbox>> = { to_approve: Inbox, approved_by_me: BadgeCheck, returned: CornerDownLeft };

export function ApprovalsScreen() {
  return (
    <Suspense fallback={<ApprovalsView tab="to_approve" onTab={() => undefined} />}>
      <ApprovalsFromUrl />
    </Suspense>
  );
}

function ApprovalsFromUrl() {
  const params = useSearchParams();
  const router = useRouter();
  const tab = approvalsTabOf(params.get('aba'));
  return <ApprovalsView tab={tab} onTab={(next) => router.push(approvalsHref(next), { scroll: false })} />;
}

/** Whether the acting member decides at some gate (same rule as the menu item); `undefined` while unknown. */
function useDecides(): boolean | undefined {
  const session = useSession();
  const roles = session.data?.current?.roles;
  if (!roles) return session.status === 'error' ? false : undefined;
  return APPROVALS_ITEM ? isNavItemVisible(APPROVALS_ITEM, { roles }) : false;
}

function ApprovalsView({ tab, onTab }: { tab: ApprovalsTab; onTab: (tab: ApprovalsTab) => void }) {
  const decides = useDecides();
  const query = useApprovals(decides ? tab : null);
  const [retryOf, setRetryOf] = useState<QueryState<ApprovalsPage> | null>(null);

  if (decides === false) {
    return (
      <AccessState
        kind="restricted"
        heading="h1"
        title={APPROVALS_COPY.noAccessTitle}
        description={APPROVALS_COPY.noAccessDescription}
        actions={
          <ButtonLink href={PRODUCTIONS_HREF} variant="primary">
            {APPROVALS_COPY.noAccessAction}
          </ButtonLink>
        }
      />
    );
  }

  // A refetch keeps the rows on screen; only the first answer of a tab shows the skeleton.
  const page = query.data?.tab === tab ? query.data : undefined;
  const counts = query.data?.counts;
  const mode: 'loading' | 'error' | 'rows' = query.status === 'error' && !page ? 'error' : page ? 'rows' : 'loading';
  const retrying = query.status === 'error' && query === retryOf;

  const tabItems: TabItem<ApprovalsTab>[] = APPROVALS_TABS.map((entry) => ({
    value: entry.value,
    label: entry.label,
    // Only "Para aprovar" counts (what waits for the viewer); a pulsing count keeps the width.
    ...(entry.value === 'to_approve' ? { count: counts ? counts.to_approve : <Skeleton width={8} height={10} /> } : {}),
  }));

  const error = (
    <ErrorState
      title={APPROVALS_COPY.error}
      description={query.error?.message}
      retrying={retrying}
      onRetry={() => {
        setRetryOf(query);
        query.retry();
      }}
    />
  );

  return (
    <>
      <PageHeader title={APPROVALS_COPY.title} />
      <FilterBar filters={false} tabs={<Tabs label="Aprovações" value={tab} items={tabItems} onChange={onTab} />} />
      <PageStack>
        <ApprovalsBody tab={tab} rows={page?.items ?? []} mode={mode} error={error} />
      </PageStack>
    </>
  );
}

function emptyBlock(tab: ApprovalsTab): ReactNode {
  const empty = APPROVALS_EMPTY[tab];
  return <EmptyState icon={TAB_ICONS[tab]} title={empty.title} description={empty.description} size="panel" />;
}

function ApprovalsBody({ tab, rows, mode, error }: { tab: ApprovalsTab; rows: readonly ApprovalItem[]; mode: 'loading' | 'error' | 'rows'; error: ReactNode }) {
  const phone = usePhone();
  if (phone) return <PhoneList tab={tab} rows={rows} mode={mode} error={error} />;
  return <ApprovalsTable tab={tab} rows={rows} mode={mode} error={error} />;
}

/** "(o) Juliana · há 2 h": who sent it. */
function SenderCell({ item, now }: { item: ApprovalItem; now: Date | undefined }) {
  const name = item.requester?.name ?? 'Alguém';
  return (
    <Chip variant="soft" size="sm" leading={<Avatar name={name} src={item.requester?.avatarUrl} size="xs" decorative />}>
      {senderLine(item, now)}
    </Chip>
  );
}

function PieceCell({ item, tab }: { item: ApprovalItem; tab: ApprovalsTab }) {
  return <CardHeader titleAs="h2" title={item.productionTitle} description={pieceMeta(item, { round: tab === 'to_approve' })} />;
}

function DueCell({ item, now }: { item: ApprovalItem; now: Date | undefined }) {
  const due = dueOf(item.dueOn, now);
  return due ? <NextAction label={due.text} due={due.tone} /> : null;
}

function ApprovalsTable({ tab, rows, mode, error }: { tab: ApprovalsTab; rows: readonly ApprovalItem[]; mode: 'loading' | 'error' | 'rows'; error: ReactNode }) {
  const router = useRouter();
  const now = useNow();
  const verb = tab === 'to_approve' ? APPROVALS_COPY.review : APPROVALS_COPY.open;
  const open = (item: ApprovalItem) => router.push(reviewHref(item.productionId, item.kind));

  const piece: Column<ApprovalItem> = { key: 'piece', header: APPROVALS_COLUMNS.piece, pinned: true, skeleton: 'lines', render: (item) => <PieceCell item={item} tab={tab} /> };
  const sender: Column<ApprovalItem> = {
    key: 'sender',
    header: APPROVALS_COLUMNS.sender,
    width: 184,
    skeleton: 'control',
    render: (item) => <SenderCell item={item} now={now} />,
  };
  const action: Column<ApprovalItem> = {
    key: 'action',
    header: <VisuallyHidden>Ação</VisuallyHidden>,
    name: 'Ação',
    align: 'end',
    width: 112,
    skeleton: 'control',
    render: (item) => (
      <Button size="sm" variant="secondary" onClick={() => open(item)}>
        {verb}
      </Button>
    ),
  };
  const columns: Column<ApprovalItem>[] =
    tab === 'to_approve'
      ? [
          piece,
          sender,
          {
            key: 'note',
            header: APPROVALS_COLUMNS.note,
            width: '28%',
            truncate: true,
            title: (item) => item.note?.trim() || undefined,
            render: (item) => noteLine(item.note, 160),
          },
          { key: 'due', header: APPROVALS_COLUMNS.due, width: 200, skeleton: 'short', render: (item) => <DueCell item={item} now={now} /> },
          action,
        ]
      : [
          piece,
          {
            key: 'decided',
            header: tab === 'returned' ? APPROVALS_COLUMNS.returnedAt : APPROVALS_COLUMNS.approvedAt,
            width: 136,
            skeleton: 'short',
            render: (item) => decidedLine(item, now),
          },
          tab === 'returned'
            ? {
                key: 'decision-note',
                header: APPROVALS_COLUMNS.decisionNote,
                width: '32%',
                truncate: true,
                title: (item) => item.decisionNote?.trim() || undefined,
                render: (item) => noteLine(item.decisionNote, 160),
              }
            : sender,
          action,
        ];

  return (
    <DataTable
      label={APPROVALS_TABS.find((entry) => entry.value === tab)?.label ?? APPROVALS_COPY.title}
      rows={[...rows]}
      rowKey={itemKey}
      rowLabel={(item) => item.productionTitle}
      columns={columns}
      density="compact"
      fixed
      onRowClick={open}
      loading={mode === 'loading'}
      loadingRows={3}
      error={mode === 'error' ? error : undefined}
      empty={emptyBlock(tab)}
      transitionKey={tab}
    />
  );
}

/** A phone: one row per piece — title, the piece and who sent it, the due date — opening the review. */
function PhoneList({ tab, rows, mode, error }: { tab: ApprovalsTab; rows: readonly ApprovalItem[]; mode: 'loading' | 'error' | 'rows'; error: ReactNode }) {
  const now = useNow();
  if (mode === 'error') return error;
  if (mode === 'rows' && rows.length === 0) return emptyBlock(tab);
  return (
    <List label={APPROVALS_TABS.find((entry) => entry.value === tab)?.label ?? APPROVALS_COPY.title}>
      {mode === 'loading'
        ? [0, 1, 2].map((index) => <ListItemSkeleton key={index} />)
        : rows.map((item) => {
            const due = tab === 'to_approve' ? dueOf(item.dueOn, now) : undefined;
            return (
              <ListItem
                key={itemKey(item)}
                leading={<Avatar name={item.requester?.name ?? 'Alguém'} src={item.requester?.avatarUrl} size="sm" decorative />}
                title={item.productionTitle}
                titleLines={2}
                description={phoneDescription(item, tab, now)}
                meta={due ? <NextAction label={due.text} due={due.tone} /> : undefined}
                href={reviewHref(item.productionId, item.kind)}
              />
            );
          })}
    </List>
  );
}
