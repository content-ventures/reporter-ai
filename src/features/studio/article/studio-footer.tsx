'use client';

import { useState } from 'react';
import {
  ActionBar,
  Button,
  ButtonLink,
  ConfirmDialog,
  IconButton,
  Menu,
  SaveIndicator,
  Tooltip,
  WorkspaceToggle,
  formatRelative,
  type MenuItem,
} from '@content-ventures/design-system/v3';
import {
  ChevronDown,
  CircleStop,
  History as HistoryIcon,
  Maximize2,
  Minimize2,
  Save,
  Send,
  Sparkles,
} from '@content-ventures/design-system/v3/icons';
import { DECISION_LABELS } from '@/domain';
import { plural } from '@/ui/format';
import { useMediaQuery } from '@/ui/use-media-query';
import { useNow } from '@/ui/time';
import { useStudio } from './studio-context';

/**
 * What "Gerar nova versão" keeps: the text so far as a version, and the images of the text in that
 * version only (the AI writes text; the cover stays).
 */
function regenerateDescription(savedAs: number | null, latestLabel: string | undefined, figures: number): string {
  const kept = savedAs !== null ? `O texto atual fica salvo como v${savedAs} antes de a IA escrever de novo.` : `A ${latestLabel ?? 'versão atual'} continua no histórico.`;
  if (figures === 0) return kept;
  const where = savedAs !== null ? `na v${savedAs}` : `na ${latestLabel ?? 'versão atual'}`;
  return `${kept} ${figures === 1 ? 'A imagem do texto fica só' : `As ${figures} imagens do texto ficam só`} ${where}; a imagem de destaque continua.`;
}

/** Speakers of the material still without a person or "Sem atribuição" (A07). */
export function useSpeakersWithoutPerson(): number {
  const { production } = useStudio();
  return production.participants.filter((participant) => !participant.person && !participant.unattributed).length;
}

/**
 * "Gerar nova versão?" — what is kept (the text so far as a version, the images of the text in it)
 * and, when it applies, that the brief changed since the text was written or that speakers still
 * have no person (their lines would be quoted without a name).
 */
export function RegenerateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const studio = useStudio();
  const latest = studio.piece.latestVersion;
  const dirty = studio.draft.dirty;
  const figures = studio.body.blocks.filter((block) => block.type === 'figure').length;
  const unmapped = useSpeakersWithoutPerson();
  const kept = regenerateDescription(dirty || !latest ? (latest?.number ?? 0) + 1 : null, latest?.label, figures);
  const notes = [
    studio.briefChanged ? 'A IA escreve com a pauta nova.' : null,
    unmapped > 0 ? `${plural(unmapped, 'falante sem pessoa', 'falantes sem pessoa')}: as falas deles saem sem nome.` : null,
  ].filter(Boolean);
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      title="Gerar nova versão?"
      description={[kept, ...notes].join(' ')}
      confirmLabel="Gerar nova versão"
      onConfirm={() => studio.actions.generate()}
    />
  );
}

/**
 * "Gerar nova versão" (or "Parar geração" while the AI writes) with its confirmation. On a desktop
 * it sits in the production header line, beside the primary action, so the text keeps the height
 * a footer would take; `compact` is the icon-only form for the narrow footer.
 */
function RegenerateButton({ compact = false, size }: { compact?: boolean; size?: 'sm' }) {
  const studio = useStudio();
  const { generation } = studio;
  const [confirm, setConfirm] = useState(false);

  const button = generation.active ? (
    compact ? (
      <Tooltip content="Parar geração">
        <IconButton label="Parar geração" icon={CircleStop} size={size} onClick={() => void studio.actions.stopGeneration()} />
      </Tooltip>
    ) : (
      <Button icon={CircleStop} size={size} onClick={() => void studio.actions.stopGeneration()}>
        Parar geração
      </Button>
    )
  ) : studio.empty ? null : compact ? (
    <Tooltip content="Gerar nova versão">
      <IconButton label="Gerar nova versão" icon={Sparkles} size={size} onClick={() => setConfirm(true)} />
    </Tooltip>
  ) : (
    <Button icon={Sparkles} size={size} onClick={() => setConfirm(true)}>
      Gerar nova versão
    </Button>
  );

  return (
    <>
      {button}
      <RegenerateDialog open={confirm} onClose={() => setConfirm(false)} />
    </>
  );
}

/**
 * Save state bound to the real save, at the end of the editor toolbar: "Salvo" (autosave runs on
 * every pause, so the time adds nothing there; the narrow footer keeps "Salvo neste navegador · há
 * 2 min"), "Salvando…", or the error with "Tentar de novo".
 */
export function StudioSaveState() {
  const { sync } = useStudio();
  return (
    <SaveIndicator
      status={sync.status.status}
      label={sync.status.status === 'saved' ? 'Salvo' : sync.status.label}
      onRetry={sync.status.conflict ? () => window.location.reload() : sync.retry}
    />
  );
}

/**
 * Footer for the narrow studio only (≤1024 px tabs, phone), where the header has no room for the
 * actions: the DS `ActionBar` with the real save state, "Gerar nova versão" as an icon and the
 * primary "Enviar para aprovação". On a desktop these live in the header and the status line.
 */
export function StudioFooter() {
  const studio = useStudio();
  const { sync } = studio;
  const now = useNow();
  const savedAt = sync.status.savedAt;
  return (
    <ActionBar
      position="static"
      status={sync.status.status}
      statusLabel={sync.status.label}
      detail={savedAt && now && sync.status.status === 'saved' ? formatRelative(savedAt, now) : undefined}
      onRetry={sync.status.conflict ? () => window.location.reload() : sync.retry}
    >
      <RegenerateButton compact />
      <SendButton />
    </ActionBar>
  );
}

function SendButton({ size }: { size?: 'sm' }) {
  const studio = useStudio();
  const link = studio.reviewLink;
  // Nothing new to send: the request waiting for approval, or — quietly — the approved version.
  if (link) {
    return (
      <ButtonLink variant={link.quiet ? 'ghost' : 'primary'} size={size} href={link.href}>
        {link.label}
      </ButtonLink>
    );
  }
  const blocked = studio.requestBlocked;
  const button = (
    <Button
      variant="primary"
      icon={Send}
      size={size}
      loading={studio.requesting}
      aria-disabled={blocked ? true : undefined}
      onClick={() => {
        if (!blocked) void studio.actions.requestReview();
      }}
    >
      Enviar para aprovação
    </Button>
  );
  return blocked ? <Tooltip content={blocked}>{button}</Tooltip> : button;
}

export function VersionMenu() {
  const studio = useStudio();
  const now = useNow();
  const versions = [...studio.piece.versions].reverse();
  const latest = studio.piece.latestVersion;
  const dirty = studio.draft.dirty;
  const items: MenuItem[] = versions.slice(0, 5).map((version) => ({
    label: version.label,
    meta: version.decision ? DECISION_LABELS[version.decision.kind] : now ? formatRelative(version.createdAt, now) : undefined,
    checked: !dirty && version.id === latest?.id,
    onSelect: () => {
      studio.setHighlightVersionId(version.id);
      studio.showSource('versions');
    },
  }));
  const label = latest ? `v${latest.number}${dirty ? ' · editado' : ''}` : 'Sem versão';
  return (
    <Menu
      label="Versões do artigo"
      align="end"
      width={280}
      sections={[
        {
          items: [
            {
              label: 'Salvar versão',
              icon: Save,
              shortcut: '⌘S',
              disabled: !dirty || studio.generation.active,
              description: !dirty ? 'Nenhuma alteração desde a última versão' : undefined,
              onSelect: () => void studio.actions.saveVersion(),
            },
          ],
        },
        ...(items.length > 0 ? [{ label: 'Versões', items }] : []),
        {
          items: [{ label: 'Ver todas as versões', icon: HistoryIcon, onSelect: () => studio.showSource('versions') }],
        },
      ]}
      trigger={(props) => (
        <Button {...props} variant="ghost" size="sm" trailingIcon={ChevronDown}>
          {label}
        </Button>
      )}
    />
  );
}

/** Header tools: panes, focus mode and the studio actions (the frame's PageHeader actions slot). */
export function StudioHeaderActions() {
  const studio = useStudio();
  const { focus, toggle } = studio.focusMode;
  // On a laptop the journey Stepper needs the room for its labels: "Gerar nova versão" turns into
  // an icon with its tooltip; wide screens keep the label.
  const roomy = useMediaQuery('(min-width: 1600px)');
  return (
    <>
      <WorkspaceToggle side="start" />
      <Tooltip content={focus ? 'Sair do modo foco' : 'Modo foco'} shortcut={focus ? 'Esc' : undefined}>
        <IconButton
          label={focus ? 'Sair do modo foco' : 'Modo foco'}
          icon={focus ? Minimize2 : Maximize2}
          variant="ghost"
          size="sm"
          aria-pressed={focus}
          onClick={toggle}
        />
      </Tooltip>
      <WorkspaceToggle side="end" />
      <RegenerateButton size="sm" compact={!roomy} />
      <SendButton size="sm" />
    </>
  );
}
