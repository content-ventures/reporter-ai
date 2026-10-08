'use client';

import type { ReactElement, ReactNode } from 'react';
import { Banner, LinkButton, TextLink } from '@content-ventures/design-system/v3';
import { Sparkles, type LucideIcon } from '@content-ventures/design-system/v3/icons';
import { BANNER_MAX_ACTIONS, BANNER_TONE, type BannerKind } from '@/registries';

/**
 * The task notice of a screen (P7, D11): ONE sentence that says where the work stands and at most
 * one verb that moves it on ("Pedro pediu ajustes: “…” · Ver comentários"). Drawn as the DS
 * `Banner variant="inline"`, toned by the status vocabulary, with the verb as a text action in the
 * tone's ink. Only `outdated` offers a second verb ("Atualizar carrossel · Entregar assim mesmo").
 * A notice verb never repeats the header primary (CONTRACT R6): screens pick it accordingly.
 */

export type BannerAction = {
  label: string;
  onClick?: () => void;
  /** Navigates (client-side through the shell's link handling). */
  href?: string;
  /** The verb is running: it stays visible, ignores clicks and says it is busy. */
  loading?: boolean;
};

export type StatusBannerProps = {
  kind: BannerKind;
  /** The sentence (ends with a period). */
  children: ReactNode;
  action?: BannerAction;
  /** Only for `outdated`: the second way out ("Entregar assim mesmo"). */
  secondaryAction?: BannerAction;
  /**
   * Live work (the AI writing): the notice carries the AI glyph. The DS Banner has no spinner slot
   * and the header's status badge already spins; the live region announces each new part.
   */
  busy?: boolean;
};

const ICONS: Partial<Record<BannerKind, LucideIcon>> = {
  writing: Sparkles,
};

function Verb({ action }: { action: BannerAction }) {
  if (action.href && !action.loading) {
    return (
      <TextLink href={action.href} size="sm" tone="inherit">
        {action.label}
      </TextLink>
    );
  }
  return (
    <LinkButton
      tone="inherit"
      onClick={action.loading ? undefined : action.onClick}
      disabled={action.loading}
      aria-busy={action.loading || undefined}
    >
      {action.label}
    </LinkButton>
  );
}

export function StatusBanner({ kind, children, action, secondaryAction, busy = false }: StatusBannerProps): ReactElement {
  const max = BANNER_MAX_ACTIONS[kind];
  const verbs = [action, secondaryAction].filter((entry): entry is BannerAction => Boolean(entry)).slice(0, max);
  const [first, second] = verbs;
  return (
    <Banner
      tone={BANNER_TONE[kind]}
      variant="inline"
      icon={busy ? Sparkles : ICONS[kind]}
      action={
        first ? (
          <>
            <Verb action={first} />
            {second ? ' · ' : null}
            {second ? <Verb action={second} /> : null}
          </>
        ) : undefined
      }
    >
      {children}
    </Banner>
  );
}

/** The same notice, named by its role on a screen: the one task notice under the header. */
export const TaskNotice: typeof StatusBanner = StatusBanner;
