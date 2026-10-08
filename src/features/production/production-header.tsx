'use client';

import { useLayoutEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  Button,
  Field,
  IconButton,
  Input,
  Menu,
  PageHeader,
  ResponsiveDialog,
  Skeleton,
  Stepper,
  StepperCompact,
  Tooltip,
} from '@content-ventures/design-system/v3';
import { ChevronDown, Ellipsis, Pencil } from '@content-ventures/design-system/v3/icons';
import type { ProductionDetail } from '@/ports';
import { useCommands, useTabSync } from '@/state';
import { OtherTabNotice } from '@/ui/shell';
import { routeStageId, stageHref, type ProductionRoute } from '@/ui/routes';
import { StatusBadge } from '@/ui/status-badge';
import { journeySteps, stageMenuItems, stageNavigable, stepperCurrent } from './journey';
import { useProductionFrame } from './production-context';

/**
 * Production header (PLAN §3.4, B02/B04): ONE line on every `/productions/[id]` route — title ·
 * status · journey Stepper · the stage's actions · ⋯. The title gives way first; then the Stepper
 * hides its names (each keeps a DS Tooltip). On a phone the Stepper becomes the DS compact one
 * ("Etapa 2 de 4 · Artigo") with a "Ver etapas" menu; the switch is the DS container query, so the
 * server HTML, the loading skeleton and the loaded header have the same shape. Each screen hosts
 * it in its own layout (`WorkspaceLayout header` in studios and review, the page top elsewhere).
 */

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
    else setError(result.refusal.message);
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

export type ProductionHeaderViewProps = {
  production: ProductionDetail | undefined;
  route: ProductionRoute;
  /** The stage's actions, after the Stepper (principal first, `size="sm"`). */
  actions?: ReactNode;
  /** Replaces the production status (the review gate shows the version's). */
  status?: ReactNode;
};

/**
 * Same line while the production loads: title (26, its line), status, Stepper and ⋯ placeholders
 * plus the screen's own actions, so nothing moves when it arrives.
 */
function HeaderSkeleton({ actions }: { actions?: ReactNode }) {
  return (
    <PageHeader
      variant="frame"
      title={<Skeleton width={240} height={26} />}
      status={<Skeleton width={110} height={22} />}
      steps={<Skeleton width="100%" height={20} />}
      stepsCompact={<Skeleton width="100%" height={52} />}
      actions={actions}
      more={<Skeleton width={32} height={32} />}
    />
  );
}

/** The header itself (no hosting registration): used by the frame and by `ProductionHeader`. */
export function ProductionHeaderView({ production, route, actions, status }: ProductionHeaderViewProps) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  // A10: this tab went read-only (the same text was saved in another tab) — said below the line.
  const { readOnly } = useTabSync();

  if (!production) return <HeaderSkeleton actions={actions} />;

  const stages = production.stages;
  const completed = production.status === 'completed';
  const viewedId = routeStageId(route, stages) ?? production.currentStageId;
  const viewedIndex = Math.max(0, stages.findIndex((stage) => stage.id === viewedId));
  const steps = journeySteps(stages, viewedIndex, completed);
  const open = (index: number) => {
    const stage = stages[index];
    if (stage && stageNavigable(stage)) router.push(stageHref(production.id, stage));
  };

  return (
    <>
      <PageHeader
        variant="frame"
        title={production.title}
        status={status ?? <StatusBadge kind="production" status={production.status} />}
        steps={
          <Stepper
            label="Etapas da produção"
            size="sm"
            steps={steps}
            current={stepperCurrent(stages, viewedIndex)}
            // A blocked stage does not open: its reason is the Stepper's Tooltip.
            canSelect={(index) => Boolean(stages[index] && stageNavigable(stages[index]))}
            onStepSelect={open}
          />
        }
        stepsCompact={
          <StepperCompact
            label="Etapas da produção"
            steps={steps}
            current={viewedIndex}
            showNext={false}
            actions={
              <Menu
                label="Etapas da produção"
                align="end"
                sections={[
                  {
                    items: stageMenuItems(stages, viewedIndex, completed).map((item, index) => ({
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
                    Ver etapas
                  </Button>
                )}
              />
            }
          />
        }
        actions={actions}
        notice={readOnly ? <OtherTabNotice variant="inline" /> : undefined}
        more={
          <Menu
            label="Mais ações da produção"
            align="end"
            sections={[{ items: [{ label: 'Renomear', icon: Pencil, onSelect: () => setRenaming(true) }] }]}
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
 * header`; Material and Entrega: the top of the page). While mounted, the frame does not draw its own.
 */
export function ProductionHeader({
  actions,
  status,
}: {
  actions?: ReactNode;
  status?: ReactNode;
  /** @deprecated Every production header is one line now; ignored. */
  compact?: boolean;
}) {
  const frame = useProductionFrame();
  const { hostHeader } = frame;
  useLayoutEffect(() => hostHeader(), [hostHeader]);
  return <ProductionHeaderView production={frame.production.data} route={frame.route} actions={actions} status={status} />;
}
