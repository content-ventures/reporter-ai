'use client';

import type { ReactNode } from 'react';
import { ActionBar, Button, ButtonLink, Tooltip, type ButtonProps } from '@content-ventures/design-system/v3';
import { ArrowRight, Check, CornerDownLeft, PenLine } from '@content-ventures/design-system/v3/icons';
import type { Guard } from '@/ports';

/**
 * Decision bar of the gate (PLAN §3.6): "Devolver com nota" and "Aprovar versão N", always in
 * view at the foot of the review. A blocked decision stays focusable with the reason in a Tooltip
 * (a run in progress, pending suggestions, a blocking check, another version on screen, a role
 * that cannot decide). Once decided, the bar offers the next step instead.
 */

function Guarded({ guard, children, ...props }: ButtonProps & { guard: Guard }) {
  const button = (
    <Button {...props} aria-disabled={guard.allowed ? undefined : true}>
      {children}
    </Button>
  );
  return guard.allowed ? button : <Tooltip content={guard.reason}>{button}</Tooltip>;
}

export type DecisionBarProps =
  | {
      state: 'open';
      versionNumber: number;
      /** Facts at the start of the bar (who sent it, pointed passages, why it is blocked). */
      start?: ReactNode;
      approve: Guard;
      requestChanges: Guard;
      onApprove: () => void;
      onReturn: () => void;
    }
  | { state: 'approved'; start?: ReactNode; next?: { label: string; href: string } }
  | { state: 'returned'; start?: ReactNode; studioHref: string };

export function DecisionBar(props: DecisionBarProps) {
  if (props.state === 'approved') {
    return (
      <ActionBar position="static" start={props.start}>
        {props.next ? (
          <ButtonLink href={props.next.href} variant="primary" trailingIcon={ArrowRight}>
            {props.next.label}
          </ButtonLink>
        ) : null}
      </ActionBar>
    );
  }
  if (props.state === 'returned') {
    return (
      <ActionBar position="static" start={props.start}>
        <ButtonLink href={props.studioHref} variant="primary" icon={PenLine}>
          Abrir estúdio
        </ButtonLink>
      </ActionBar>
    );
  }
  return (
    <ActionBar position="static" start={props.start}>
      <Guarded guard={props.requestChanges} icon={CornerDownLeft} onClick={props.onReturn}>
        Devolver com nota
      </Guarded>
      <Guarded guard={props.approve} variant="primary" icon={Check} onClick={props.onApprove}>
        Aprovar versão {props.versionNumber}
      </Guarded>
    </ActionBar>
  );
}
