'use client';
import { useWorkspaceHref } from '@/ui/workspace-navigation';

import { useId, useLayoutEffect, useState, type ReactElement, type ReactNode } from 'react';
import { useWorkspaceRouter as useRouter } from '@/ui/workspace-navigation';
import {
  ActionBar,
  Button,
  ButtonLink,
  Field,
  IconButton,
  Input,
  Menu,
  PageHeader,
  ResponsiveDialog,
  Skeleton,
  Tooltip,
  type MenuSection,
} from '@content-ventures/design-system/v3';
import { ChevronDown, Ellipsis, Pencil, type LucideIcon } from '@content-ventures/design-system/v3/icons';
import type { ProductionDetail } from '@/ports';
import { useCan, useCommands, useTabSync } from '@/state';
import { OtherTabNotice, requestLeave } from '@/ui/shell';
import { localRoleMenu, useActAs } from '@/ui/shell/act-as';
import { routeStageId, stageHref, type ProductionRoute } from '@/ui/routes';
import { StatusBadge } from '@/ui/status-badge';
import { decidesAt, journeyLabel, journeyMenuItems, viewedStageIndex } from './journey';
import { useJourney } from '@/features/hard-news/use-journey';
import { useProductionFrame } from './production-context';
import { isPermissionRefusal, notifyRefusal } from '@/ui/permission-dialog';

/**
 * Production header (§2.6, D2/D11/P3): ONE line on every `/productions/[id]` route, in reading
 * order — title · status · journey menu ("Artigo · 2 de 5 ▾") · [blocked reason] · secondary · ONE
 * primary with the next step on it · ⋯. No back link: the way back is the TopBar trail
 * ("Produções › <título> › <etapa>", declared by the frame). No panel icons, no focus mode, no ✦,
 * no Stepper. Under the line, at most ONE notice (approval, generation, other tab). Each screen
 * hosts it in its own layout (`WorkspaceLayout header` in studios and review, `StagePage`
 * elsewhere); on narrow layouts the primary moves to `ProductionPrimaryBar` at the bottom.
 * The blocked reason is DS `PageHeader actionsNote`, tied to the button by `aria-describedby`.
 */

export type HeaderPrimary =
  | {
      kind: 'button';
      label: string;
      onClick: () => void;
      icon?: LucideIcon;
      loading?: boolean;
      /** Visible next to the button (never only a Tooltip); the button stays focusable, `aria-disabled`. */
      blockedReason?: string;
    }
  | { kind: 'link'; label: string; href: string; icon?: LucideIcon };

export type HeaderSecondary = { label: string; onClick?: () => void; href?: string; icon?: LucideIcon };

export type ProductionHeaderProps = {
  /** None while the AI writes and while the author waits for approval (the banner carries the verb). */
  primary?: HeaderPrimary;
  /** At most ONE quiet button before the primary (Entrega: "Copiar texto do artigo"). */
  secondary?: HeaderSecondary;
  /** Default: the status of the piece on screen (studio, review) or of the production. */
  status?: ReactNode;
  /** The screen's ⋯ items, above the production's own ("Renomear"). */
  menu?: MenuSection[];
  /** ONE StatusBanner / ApprovalBanner / GenerationBanner, full width under the line. */
  notice?: ReactNode;
  /** @deprecated Wave-1 compatibility (screens not yet on `primary`); removed at I2. */
  actions?: ReactNode;
  /** @deprecated Ignored: every production header is one line. Removed at I2. */
  compact?: boolean;
};

function RenameDialog({ production, open, onClose }: { production: ProductionDetail; open: boolean; onClose: () => void }) {
  const commands = useCommands();
  const [title, setTitle] = useState(production.title);
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setTitle(production.title);
      setError(undefined);
    }
  }

  async function save() {
    setSaving(true);
    const result = await commands.production.rename(production.id, title.trim());
    setSaving(false);
    if (result.ok) onClose();
    else if (isPermissionRefusal(result.refusal)) {
      onClose();
      notifyRefusal(undefined, result.refusal);
    } else setError(result.refusal.message);
  }

  return (
    <ResponsiveDialog
      open={open}
      onClose={onClose}
      title="Renomear produção"
      size="sm"
      dirty={title !== production.title}
      footer={
        <>
          <Button onClick={onClose}>Cancelar</Button>
          <Button variant="primary" loading={saving} onClick={save}>
            Salvar nome
          </Button>
        </>
      }
    >
      <Field label="Título interno" error={error}>
        {({ id, describedBy, invalid }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            invalid={invalid}
            value={title}
            maxLength={120}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void save();
              }
            }}
          />
        )}
      </Field>
    </ResponsiveDialog>
  );
}

/** The visible reason of a blocked primary, when there is one (`aria-describedby` of the button). */
function blockedReasonOf(primary: HeaderPrimary | undefined): string | undefined {
  return primary?.kind === 'button' && primary.blockedReason ? primary.blockedReason : undefined;
}

/** The primary itself: a link when it only navigates, a button otherwise (blocked: `aria-disabled` + reason). */
function PrimaryControl({ primary, size, reasonId }: { primary: HeaderPrimary; size: 'sm' | 'md'; reasonId?: string }) {
  const workspaceHrefFor = useWorkspaceHref();
  if (primary.kind === 'link') {
    return (
      <ButtonLink href={workspaceHrefFor(primary.href)} variant="primary" size={size} icon={primary.icon}>
        {primary.label}
      </ButtonLink>
    );
  }
  const blocked = Boolean(primary.blockedReason);
  return (
    <Button
      variant="primary"
      size={size}
      icon={primary.icon}
      loading={primary.loading}
      aria-disabled={blocked || undefined}
      aria-describedby={blocked ? reasonId : undefined}
      onClick={primary.onClick}
    >
      {primary.label}
    </Button>
  );
}

function SecondaryControl({ secondary }: { secondary: HeaderSecondary }) {
  const workspaceHrefFor = useWorkspaceHref();
  if (secondary.href) {
    return (
      <ButtonLink href={workspaceHrefFor(secondary.href)} size="sm" icon={secondary.icon}>
        {secondary.label}
      </ButtonLink>
    );
  }
  return (
    <Button size="sm" icon={secondary.icon} onClick={secondary.onClick}>
      {secondary.label}
    </Button>
  );
}

/** Secondary · primary (· the deprecated free-form actions), or nothing. The reason is `actionsNote`. */
function headerActions(
  primary: HeaderPrimary | undefined,
  secondary: HeaderSecondary | undefined,
  actions: ReactNode,
  reasonId: string,
): ReactNode {
  if (!primary && !secondary && !actions) return undefined;
  return (
    <>
      {secondary ? <SecondaryControl secondary={secondary} /> : null}
      {primary ? <PrimaryControl primary={primary} size="sm" reasonId={reasonId} /> : null}
      {actions}
    </>
  );
}

export type ProductionHeaderViewProps = ProductionHeaderProps & {
  production: ProductionDetail | undefined;
  route: ProductionRoute;
};

type ActionsNote = { id: string; text: string } | undefined;

/** Same line while the production loads (title, status and journey placeholders, ⋯), so nothing moves. */
function HeaderSkeleton({ actions, actionsNote }: { actions?: ReactNode; actionsNote: ActionsNote }) {
  return (
    <PageHeader
      variant="frame"
      title={<Skeleton width={240} height={26} />}
      status={<Skeleton width={220} height={22} />}
      actions={actions}
      actionsNote={actionsNote}
      more={<Skeleton width={32} height={32} />}
    />
  );
}

/** The status the header shows by default: the piece on screen in studios and review, else the production. */
function defaultStatus(production: ProductionDetail, route: ProductionRoute): ReactNode {
  if (route.kind === 'studio' || route.kind === 'review') {
    const piece = production.pieces.find((candidate) => candidate.kind === route.pieceKind);
    if (piece) return <StatusBadge kind="piece" status={piece.status} />;
  }
  return <StatusBadge kind="production" status={production.status} />;
}

/** The journey menu: "Artigo · 2 de 5 ▾", every stage with where it stands; blocked stages say why. */
function JourneyMenu({ production, route }: { production: ProductionDetail; route: ProductionRoute }) {
  const router = useRouter();
  // R2: a covered news story starts with "Apuração" (same production, same menu).
  const journey = useJourney(production);
  const stages = journey.stages;
  const viewedIndex = viewedStageIndex(stages, routeStageId(route, stages), journey.currentStageId);
  const items = journeyMenuItems(stages, viewedIndex, production.status === 'completed');
  const open = (index: number) => {
    const stage = stages[index];
    if (!stage || items[index]?.disabled) return;
    const href = journey.hrefOf(stage) ?? stageHref(production.id, stage, { canDecide: decidesAt(production.approvals, stage.pieceKind) });
    if (requestLeave(href)) router.push(href);
  };
  return (
    <Menu
      label="Etapas da produção"
      sections={[
        {
          items: items.map((item, index) => ({
            label: item.label,
            description: item.description,
            disabled: item.disabled,
            checked: item.checked,
            onSelect: () => open(index),
          })),
        },
      ]}
      trigger={(props) => (
        <Button {...props} size="sm" variant="ghost" trailingIcon={ChevronDown}>
          {journeyLabel(stages, viewedIndex)}
        </Button>
      )}
    />
  );
}

/** The header itself (no hosting registration): used by the frame and by `ProductionHeader`. */
export function ProductionHeaderView({
  production,
  route,
  primary,
  secondary,
  status,
  menu,
  notice,
  actions,
}: ProductionHeaderViewProps) {
  const [renaming, setRenaming] = useState(false);
  const canRename = useCan('production.edit');
  const reasonId = useId();
  const localRoles = localRoleMenu(useActAs());
  // A10: this tab went read-only (the same text was saved in another tab). Said under the line,
  // unless the screen already shows its one notice.
  const { readOnly } = useTabSync();
  const line = headerActions(primary, secondary, actions, reasonId);
  const reason = blockedReasonOf(primary);
  const actionsNote: ActionsNote = reason ? { id: reasonId, text: reason } : undefined;

  if (!production) return <HeaderSkeleton actions={line} actionsNote={actionsNote} />;

  const sections: MenuSection[] = [
    ...(menu ?? []).filter((section) => section.items.length > 0),
    ...(localRoles.length ? [{ items: [{ label: 'Trocar perfil', description: 'Ambiente local', items: localRoles[0].items }] }] : []),
    ...(canRename ? [{ items: [{ label: 'Renomear', icon: Pencil, onSelect: () => setRenaming(true) }] }] : []),
  ];

  return (
    <>
      <PageHeader
        variant="frame"
        title={production.title}
        status={
          <>
            {status ?? defaultStatus(production, route)}
            <JourneyMenu production={production} route={route} />
          </>
        }
        actions={line}
        actionsNote={actionsNote}
        notice={notice ?? (readOnly ? <OtherTabNotice variant="inline" /> : undefined)}
        more={
          <Menu
            label="Mais ações"
            align="end"
            sections={sections}
            trigger={(props) => (
              <Tooltip content="Mais ações">
                <IconButton {...props} label="Mais ações" icon={Ellipsis} variant="ghost" size="sm" />
              </Tooltip>
            )}
          />
        }
      />
      <RenameDialog production={production} open={renaming} onClose={() => setRenaming(false)} />
    </>
  );
}

/**
 * The production header for screens that lay it out themselves (studios and review: `WorkspaceLayout
 * header`; Material and Entrega: `StagePage`). While mounted, the frame does not draw its own.
 */
export function ProductionHeader(props: ProductionHeaderProps): ReactElement {
  const frame = useProductionFrame();
  const { hostHeader } = frame;
  useLayoutEffect(() => hostHeader(), [hostHeader]);
  return <ProductionHeaderView production={frame.production.data} route={frame.route} {...props} />;
}

/**
 * The primary on narrow layouts (≤1024 inside a `WorkspaceLayout` footer, ≤640 in `StagePage`):
 * DS `ActionBar` with the button; `detail` (facts, e.g. the footer's "Falta 5") at the start and the
 * visible blocked reason right before the button (DS `ActionBar detail` + `detailId`, tied to the
 * button by `aria-describedby`). The screen passes the same `primary` it gives the header.
 */
export function ProductionPrimaryBar({ primary, detail }: { primary?: HeaderPrimary; detail?: ReactNode }): ReactElement | null {
  const reasonId = useId();
  if (!primary) return null;
  const reason = blockedReasonOf(primary);
  return (
    <ActionBar position="static" start={detail} detail={reason} detailId={reason ? reasonId : undefined}>
      <PrimaryControl primary={primary} size="md" reasonId={reasonId} />
    </ActionBar>
  );
}

/** "Artigo · 2 de 5": the stage on screen and its place in the journey ('' while the production loads). */
export function useJourneyLabel(): string {
  const { production, route } = useProductionFrame();
  const detail = production.data;
  const journey = useJourney(detail);
  if (!detail) return '';
  return journeyLabel(journey.stages, viewedStageIndex(journey.stages, routeStageId(route, journey.stages), journey.currentStageId));
}
