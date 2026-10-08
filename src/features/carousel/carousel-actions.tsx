'use client';

import {
  Button,
  ButtonLink,
  formatRelative,
  IconButton,
  Menu,
  SaveIndicator,
  Tooltip,
  WorkspaceToggle,
  type MenuItem,
  type SaveStatus,
} from '@content-ventures/design-system/v3';
import { ChevronDown, CircleStop, Maximize2, Minimize2, Save, Send, Sparkles } from '@content-ventures/design-system/v3/icons';
import { DECISION_LABELS, type VersionView } from '@/domain';
import { useFocusMode } from '@/ui/shell';
import { useMediaQuery } from '@/ui/use-media-query';
import { useNow } from '@/ui/time';

/**
 * The carousel studio's actions, laid out like the article's (B02): on a desktop the generation
 * control and the primary action close the production header line, and the document's state
 * ("Salvo", "v2 ▾" with "Salvar versão") closes the stage toolbar — no footer row. Narrow frames
 * (tabs, phone) keep the footer, where the header has no room.
 */

export type CarouselGenerateAction = {
  running: boolean;
  stopping: boolean;
  /** Why "Gerar nova versão" is unavailable (article not approved, run in progress). */
  reason?: string;
  onStop: () => void;
  onRegenerate: () => void;
};

export type CarouselReviewAction = {
  /** Already sent: the action opens the review instead. */
  inReview: boolean;
  href: string;
  /** Why "Enviar para aprovação" is unavailable. */
  reason?: string;
  sending: boolean;
  onSend: () => void;
};

export function CarouselSendButton({ action, size }: { action: CarouselReviewAction; size?: 'sm' }) {
  if (action.inReview) {
    return (
      <ButtonLink href={action.href} variant="primary" icon={Send} size={size}>
        Abrir revisão
      </ButtonLink>
    );
  }
  if (action.reason) {
    return (
      <Tooltip content={action.reason}>
        <Button variant="primary" icon={Send} size={size} aria-disabled>
          Enviar para aprovação
        </Button>
      </Tooltip>
    );
  }
  return (
    <Button variant="primary" icon={Send} size={size} loading={action.sending} onClick={action.onSend}>
      Enviar para aprovação
    </Button>
  );
}

/** "Gerar nova versão" (a confirmation follows), or "Parar geração" while the copy is written. */
export function CarouselGenerateButton({ action, compact = false, size }: { action: CarouselGenerateAction; compact?: boolean; size?: 'sm' }) {
  if (action.running) {
    return compact ? (
      <Tooltip content="Parar geração">
        <IconButton label="Parar geração" icon={CircleStop} size={size} aria-disabled={action.stopping || undefined} onClick={action.onStop} />
      </Tooltip>
    ) : (
      <Button icon={CircleStop} size={size} loading={action.stopping} onClick={action.onStop}>
        Parar geração
      </Button>
    );
  }
  const onClick = action.reason ? undefined : action.onRegenerate;
  return (
    <Tooltip content={action.reason ?? 'Gerar nova versão'}>
      {compact ? (
        <IconButton label="Gerar nova versão" icon={Sparkles} size={size} aria-disabled={action.reason ? true : undefined} onClick={onClick} />
      ) : (
        <Button icon={Sparkles} size={size} aria-disabled={action.reason ? true : undefined} onClick={onClick}>
          Gerar nova versão
        </Button>
      )}
    </Tooltip>
  );
}

/** Header tools: panes, focus mode, generation and the primary action (PageHeader actions slot). */
export function CarouselHeaderActions({ generate, review }: { generate: CarouselGenerateAction; review: CarouselReviewAction }) {
  const focusMode = useFocusMode();
  // A laptop keeps the room for the journey Stepper: "Gerar nova versão" becomes an icon with its tip.
  const roomy = useMediaQuery('(min-width: 1600px)');
  return (
    <>
      <WorkspaceToggle side="start" />
      <Tooltip content={focusMode.focus ? 'Sair do modo foco' : 'Modo foco'} shortcut={focusMode.focus ? 'Esc' : undefined}>
        <IconButton
          label={focusMode.focus ? 'Sair do modo foco' : 'Modo foco'}
          icon={focusMode.focus ? Minimize2 : Maximize2}
          variant="ghost"
          size="sm"
          aria-pressed={focusMode.focus}
          onClick={focusMode.toggle}
        />
      </Tooltip>
      <WorkspaceToggle side="end" />
      <CarouselGenerateButton action={generate} compact={!roomy} size="sm" />
      <CarouselSendButton action={review} size="sm" />
    </>
  );
}

export type CarouselSaveState = { status: SaveStatus; label: string; onRetry?: () => void };

/**
 * End of the stage toolbar: the real save state ("Salvo": autosave runs on every pause, so the
 * time adds nothing here) and the versions menu — "Salvar versão" (⌘S), the last versions and
 * "Restaurar" through a confirmation.
 */
export function CarouselDocumentState({
  save,
  versions,
  latest,
  dirty,
  running,
  onSaveVersion,
  onRestore,
}: {
  save: CarouselSaveState;
  versions: readonly VersionView[];
  latest: VersionView | undefined;
  /** The draft differs from the latest version. */
  dirty: boolean;
  running: boolean;
  onSaveVersion: () => void;
  onRestore: (version: VersionView) => void;
}) {
  const now = useNow();
  const items: MenuItem[] = [...versions]
    .reverse()
    .slice(0, 5)
    .map((version) => {
      const current = !dirty && version.id === latest?.id;
      return {
        label: version.label,
        meta: version.decision ? DECISION_LABELS[version.decision.kind] : now ? formatRelative(version.createdAt, now) : undefined,
        checked: current,
        disabled: running && !current,
        ...(current ? {} : { onSelect: () => onRestore(version) }),
      };
    });
  const label = latest ? `v${latest.number}${dirty ? ' · editado' : ''}` : 'Sem versão';
  return (
    <>
      <SaveIndicator status={save.status} label={save.status === 'saved' ? 'Salvo' : save.label} onRetry={save.onRetry} />
      <Menu
        label="Versões do carrossel"
        align="end"
        width={280}
        sections={[
          {
            items: [
              {
                label: 'Salvar versão',
                icon: Save,
                shortcut: '⌘S',
                disabled: running || (!dirty && Boolean(latest)),
                description: running ? 'Aguarde a geração terminar.' : !dirty && latest ? 'Nenhuma alteração desde a última versão' : undefined,
                onSelect: onSaveVersion,
              },
            ],
          },
          ...(items.length > 0 ? [{ label: 'Versões', items }] : []),
        ]}
        trigger={(props) => (
          <Button {...props} variant="ghost" size="sm" trailingIcon={ChevronDown}>
            {label}
          </Button>
        )}
      />
    </>
  );
}
