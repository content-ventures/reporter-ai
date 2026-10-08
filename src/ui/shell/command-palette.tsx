'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { CommandPalette, toast, type CommandGroup, type CommandItem } from '@content-ventures/design-system/v3';
import { Database, Eraser, ListChecks, RotateCcw, Timer, TriangleAlert, type LucideIcon } from '@content-ventures/design-system/v3/icons';
import type { ProductionListItem, SimulationScenario } from '@/ports';
import { availableIn, navigationFor, PRIMARY_ACTIONS, SOURCE_ORIGIN_LABELS } from '@/registries';
import { useAuditControls, useSession, useSimulation } from '@/state';
import { formatShortDate } from '../format';
import { iconFor } from '../icons';
import { PersonAvatar } from '../person-avatar';
import { OVERVIEW_HREF, productionHref } from '../routes';
import { StatusBadge } from '../status-badge';
import { memberDetail, useActAs } from './act-as';
import { useRegisteredCommandGroups } from './command-registry';
import { requestLeave } from './leave-guard';
import { armSimulation, useArmedSimulation } from './simulation';

const RECENT_COUNT = 4;

function scenarioIcon(scenario: SimulationScenario): LucideIcon {
  if (scenario.id.startsWith('fail')) return TriangleAlert;
  if (scenario.id === 'slow') return Timer;
  return ListChecks;
}

function productionCommand(item: ProductionListItem, go: (href: string) => void): CommandItem {
  const people = item.participants.map((participant) => participant.person?.name ?? participant.label).join(' ');
  return {
    id: `production-${item.id}`,
    label: item.title,
    description: item.material
      ? [SOURCE_ORIGIN_LABELS[item.material.origin], item.material.recordedOn ? formatShortDate(item.material.recordedOn) : null].filter(Boolean).join(' · ')
      : undefined,
    trailing: <StatusBadge kind="production" status={item.status} variant="text" size="sm" />,
    keywords: `${item.material?.title ?? ''} ${item.statusLabel} ${item.owner.name} ${people}`,
    onSelect: () => go(productionHref(item.id)),
  };
}

/**
 * ⌘K: Ações (Nova produção), commands of the current screen, Ir para (released menu items),
 * Produções (search by title, status, people) with the latest ones as "Recentes", and — only
 * in the local simulation — Simulação: restore the example, start empty, arm a failure for the
 * next generation.
 */
export function ShellCommandPalette({
  open,
  onClose,
  productions,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  productions: readonly ProductionListItem[];
  loading: boolean;
}) {
  const router = useRouter();
  const registered = useRegisteredCommandGroups();
  const simulation = useSimulation();
  const armed = useArmedSimulation();
  const audit = useAuditControls();
  const { current: acting, members, actAs } = useActAs();
  const actingId = acting?.id;
  // "Ir para" lists the menu items this member can open (Logs only for admins). "Em breve" items
  // stay out: a ⌘K result always does something, and the DS CommandItem has no disabled state.
  const roles = useSession().data?.current?.roles;

  const groups = useMemo<CommandGroup[]>(() => {
    const go = (href: string) => {
    if (requestLeave(href)) router.push(href);
  };
    const actions: CommandGroup = {
      label: 'Ações',
      showWhenEmpty: true,
      items: availableIn(PRIMARY_ACTIONS).map((action) => ({
        id: `action-${action.id}`,
        label: action.label,
        icon: iconFor(action.icon),
        onSelect: () => go(action.href),
      })),
    };
    const navigation: CommandGroup = {
      label: 'Ir para',
      showWhenEmpty: true,
      items: navigationFor(undefined, roles ? { roles } : undefined).flatMap((section) =>
        section.items.map((item) => ({
          id: `go-${item.id}`,
          label: item.label,
          icon: iconFor(item.icon),
          keywords: section.group.label,
          onSelect: () => go(item.href),
        })),
      ),
    };
    const list: CommandGroup = {
      label: 'Produções',
      showWhenEmpty: false,
      items: productions.map((item) => productionCommand(item, go)),
    };
    const result = [actions, ...registered.map((group) => ({ showWhenEmpty: true, ...group })), navigation, list];
    if (simulation.available) {
      result.push({
        label: 'Simulação',
        showWhenEmpty: true,
        items: [
          {
            id: 'simulation-reset',
            label: 'Restaurar exemplo',
            icon: RotateCcw,
            keywords: 'recomeçar demonstração fixtures',
            onSelect: () => {
              simulation.reset();
              router.push(OVERVIEW_HREF);
              toast('Exemplo restaurado');
            },
          },
          {
            id: 'simulation-empty',
            label: 'Começar vazio',
            icon: Eraser,
            keywords: 'limpar sem produções',
            onSelect: () => {
              simulation.startEmpty();
              router.push(OVERVIEW_HREF);
              toast('Espaço de trabalho vazio');
            },
          },
          // "Entrar como" (B06): see the product with another member's roles.
          ...members
            .filter((member) => member.id !== actingId)
            .map((member) => ({
              id: `simulation-act-as-${member.id}`,
              label: `Entrar como ${member.name}`,
              description: memberDetail(member),
              leading: <PersonAvatar person={member} size="xs" decorative />,
              keywords: 'pessoa papel aprovador editor admin trocar conta sessão',
              onSelect: () => void actAs(member),
            })),
          ...simulation.scenarios.map((scenario) => {
            const active = armed?.id === scenario.id;
            return {
              id: `simulation-${scenario.id}`,
              label: scenario.label,
              description: active ? 'Armado para a próxima geração' : 'Na próxima geração',
              icon: scenarioIcon(scenario),
              keywords: 'cenário falha simulação',
              onSelect: () => {
                armSimulation(active ? null : scenario);
                toast(active ? 'Cenário desarmado' : 'Cenário armado', { tone: 'info', description: scenario.label });
              },
            };
          }),
          ...(audit.simulateOutage
            ? [
                {
                  id: 'simulation-audit-outage',
                  label: 'Deixar o log indisponível',
                  description: 'Na próxima consulta dos logs',
                  icon: Database,
                  keywords: 'cenário falha simulação auditoria logs',
                  onSelect: () => {
                    audit.simulateOutage?.();
                    toast('Cenário armado', { tone: 'info', description: 'Log indisponível na próxima consulta' });
                  },
                },
              ]
            : []),
        ],
      });
    }
    return result;
  }, [actAs, actingId, armed, audit, members, productions, registered, roles, router, simulation]);

  const recent = useMemo(
    () => productions.slice(0, RECENT_COUNT).map((item) => productionCommand(item, (href) => router.push(href))),
    [productions, router],
  );

  return (
    <CommandPalette
      open={open}
      onClose={onClose}
      groups={groups}
      recent={recent}
      loading={loading}
      placeholder="Buscar produções, páginas e ações"
    />
  );
}
