'use client';

import { useMemo, useState, type ReactElement } from 'react';
import {
  Avatar,
  Badge,
  Button,
  DatePicker,
  Field,
  FieldGroup,
  LinkButton,
  List,
  ListItem,
  MetaList,
  ResponsiveDialog,
  Section,
  Select,
  Textarea,
  toast,
  type SelectOption,
} from '@content-ventures/design-system/v3';
import type { PersonId, ProductionId, Role, SendItemLevel, SendTarget } from '@/domain';
import type { PersonSummary, PieceApproval, RequestedReview } from '@/ports';
import { gateById } from '@/registries';
import { useCommands, useSession } from '@/state';
import {
  APPROVER_ROLE_LABELS,
  calendarDate,
  DUE_OPTIONS,
  dueOnFor,
  INVALID_DUE,
  missingItemsReason,
  NO_APPROVER_REASON,
  NOTE_MAX,
  SEND_FIELDS,
  SEND_LEVEL_LABELS,
  sendButtonLabel,
  sendDialogTitle,
  sentToast,
  type DueChoice,
} from './approval-copy';
import { useMediaQuery } from './use-media-query';
import { useNow } from './time';

/**
 * "Enviar para aprovação" (D10, brief §5, WordPress pre-publish pattern): what still blocks the
 * send ("Falta") apart from what is only a warning ("Aviso"), each with a link to the spot; then
 * "Quem aprova" (the last approver first), an optional "Recado" and "Para quando". The primary
 * names the person ("Enviar para Pedro"); while a "Falta" remains it stays focusable but inert and
 * the footer says why, in words. The checklist is live: fixing something updates the rows.
 */

export type SendForApprovalDialogProps = {
  open: boolean;
  onClose: () => void;
  productionId: ProductionId;
  /** Live: items update as the person fixes things. */
  approval: PieceApproval;
  pieceLabel: 'artigo' | 'carrossel';
  /** The dialog closes first, then the screen jumps to the spot. */
  onJump: (target: SendTarget) => void;
  /** "Marcar como revisado" on the "Texto não revisado" row: done right there, the dialog stays open. */
  onMarkReviewed?: () => void;
  /** Flush the autosave before sending; `false` aborts. */
  prepare?: () => Promise<boolean>;
  onSent?: (result: RequestedReview) => void;
};

/** Long enough for the dialog (160 ms) or the sheet (200 ms) to leave before the screen moves. */
const JUMP_DELAY_MS = 220;

const LEVEL_TONE: Record<SendItemLevel, 'red' | 'amber' | 'gray'> = { missing: 'red', warning: 'amber', ok: 'gray' };

type DeciderRole = keyof typeof APPROVER_ROLE_LABELS;

/** The role that lets a member decide at the gate, the gate's own role before "Admin". */
function deciderRole(roles: readonly Role[] | undefined, gateRoles: readonly Role[]): DeciderRole | undefined {
  if (!roles) return undefined;
  const own = gateRoles.find((role): role is DeciderRole => role !== 'admin' && role !== 'editor' && roles.includes(role));
  return own ?? (roles.includes('admin') ? 'admin' : undefined);
}

/** "Quem aprova" before anyone chooses: the last approver, else the first with the gate's own role. */
function defaultAssignee(approval: PieceApproval, roleOf: (id: PersonId) => DeciderRole | undefined): PersonId | '' {
  const { approvers, suggestedAssigneeId } = approval.send;
  if (suggestedAssigneeId && approvers.some((person) => person.id === suggestedAssigneeId)) return suggestedAssigneeId;
  const gateOwn = approvers.find((person) => {
    const role = roleOf(person.id);
    return role !== undefined && role !== 'admin';
  });
  return (gateOwn ?? approvers[0])?.id ?? '';
}

export function SendForApprovalDialog({ open, onClose, approval, onJump, onMarkReviewed, prepare, onSent }: SendForApprovalDialogProps): ReactElement {
  const commands = useCommands();
  const session = useSession();
  const now = useNow();
  const narrow = useMediaQuery('(max-width: 640px)');

  const gateRoles = useMemo(() => gateById(approval.gateId)?.roles ?? [], [approval.gateId]);
  const roleOf = useMemo(() => {
    const members = session.data?.members ?? [];
    return (id: PersonId) => deciderRole(members.find((member) => member.id === id)?.roles, gateRoles);
  }, [session.data?.members, gateRoles]);

  const { approvers, items, guard, isResend } = approval.send;
  const [assigneeId, setAssigneeId] = useState<PersonId | ''>('');
  const [note, setNote] = useState('');
  const [dueChoice, setDueChoice] = useState<DueChoice>('none');
  const [picked, setPicked] = useState('');
  const [errors, setErrors] = useState<{ assignee?: string; due?: string }>({});
  const [sending, setSending] = useState(false);

  // Every opening starts fresh, with the suggested approver.
  const [openedFor, setOpenedFor] = useState(false);
  if (open !== openedFor) {
    setOpenedFor(open);
    if (open) {
      setAssigneeId(defaultAssignee(approval, roleOf));
      setNote('');
      setDueChoice('none');
      setPicked('');
      setErrors({});
      setSending(false);
    }
  }
  // The approvers arrived after the dialog opened (people still loading).
  const chosen: PersonSummary | undefined =
    approvers.find((person) => person.id === assigneeId) ?? approvers.find((person) => person.id === defaultAssignee(approval, roleOf));

  const options: SelectOption[] = approvers.map((person) => {
    const role = roleOf(person.id);
    return {
      value: person.id,
      label: person.name,
      description: role ? APPROVER_ROLE_LABELS[role] : person.title,
      leading: <Avatar name={person.name} src={person.avatarUrl} size="xs" decorative />,
    };
  });

  const missingItems = items.filter((item) => item.level === 'missing');
  const missing = missingItems.length;
  const reason =
    approvers.length === 0
      ? NO_APPROVER_REASON
      : missing > 0
        ? missingItemsReason(missing, missingItems[0]?.id === 'text-review')
        : !guard.allowed
          ? guard.reason
          : undefined;
  const blocked = reason !== undefined || !chosen;

  const today = now ? calendarDate(now) : undefined;

  function jump(target: SendTarget) {
    onClose();
    window.setTimeout(() => onJump(target), JUMP_DELAY_MS);
  }

  /** The row's link: a jump to the spot, or (the text review) the fix itself, right on the row. */
  function rowAction(action: { label: string; target: SendTarget } | undefined): ReactElement | undefined {
    if (!action) return undefined;
    const { target } = action;
    if (target.kind === 'mark-reviewed') {
      return onMarkReviewed ? <LinkButton onClick={onMarkReviewed}>{action.label}</LinkButton> : undefined;
    }
    return <LinkButton onClick={() => jump(target)}>{action.label}</LinkButton>;
  }

  async function send() {
    if (blocked || sending || !chosen) return;
    const reference = new Date();
    const dueOn = dueOnFor(dueChoice, reference, picked);
    const minimum = calendarDate(reference) ?? '';
    if (dueChoice === 'pick' && (!dueOn || dueOn < minimum)) {
      setErrors({ due: INVALID_DUE });
      return;
    }
    setErrors({});
    setSending(true);
    if (prepare && !(await prepare())) {
      setSending(false);
      return;
    }
    const trimmed = note.trim();
    const result = await commands.production.requestReview(approval.pieceId, {
      assigneeId: chosen.id,
      ...(trimmed ? { note: trimmed } : {}),
      ...(dueOn ? { dueOn } : {}),
    });
    setSending(false);
    if (!result.ok) {
      const { code, message } = result.refusal;
      if (code === 'unknown_assignee' || code === 'assignee_cannot_approve' || code === 'self_assign') setErrors({ assignee: message });
      else if (code === 'invalid_due') setErrors({ due: message });
      else toast('Não foi enviado', { tone: 'error', description: message });
      return;
    }
    toast(sentToast(chosen.name));
    onSent?.(result.value);
    onClose();
  }

  const reasonLine = reason ? <MetaList key="reason" size="sm" items={[reason]} /> : null;
  const cancel = (
    <Button key="cancel" onClick={onClose} disabled={sending}>
      Cancelar
    </Button>
  );
  const primary = (
    <Button
      key="send"
      variant="primary"
      loading={sending}
      aria-disabled={blocked || undefined}
      onClick={() => void send()}
    >
      {sendButtonLabel(isResend, chosen?.name)}
    </Button>
  );

  return (
    <ResponsiveDialog
      open={open}
      onClose={sending ? () => undefined : onClose}
      title={sendDialogTitle(isResend)}
      // `lg`: the blocked reason, Cancelar and the primary share one footer line.
      size="lg"
      dirty={note.trim().length > 0}
      footer={
        // The sheet stacks its footer bottom-up (primary on top): the reason goes last there so it
        // still reads right above the buttons; in the dialog it sits just before them.
        narrow ? (
          <>
            {cancel}
            {primary}
            {reasonLine}
          </>
        ) : (
          <>
            {reasonLine}
            {cancel}
            {primary}
          </>
        )
      }
    >
      <Section>
        {items.length > 0 ? (
          <FieldGroup label={SEND_FIELDS.checklist}>
            <List label={SEND_FIELDS.checklist}>
              {items.map(({ id, level, text, action }) => (
                <ListItem
                  key={id}
                  density="sm"
                  titleLines={2}
                  leading={
                    <Badge tone={LEVEL_TONE[level]} size="sm">
                      {SEND_LEVEL_LABELS[level]}
                    </Badge>
                  }
                  title={text}
                  actions={rowAction(action)}
                />
              ))}
            </List>
          </FieldGroup>
        ) : null}
        <Field label={SEND_FIELDS.assignee} required error={errors.assignee}>
          {({ id, describedBy, invalid }) => (
            <Select
              id={id}
              describedBy={describedBy}
              invalid={invalid}
              value={chosen?.id ?? ''}
              onChange={(value) => {
                setAssigneeId(value as PersonId);
                setErrors((current) => ({ ...current, assignee: undefined }));
              }}
              options={options}
              disabled={approvers.length === 0 || sending}
              autoFocus
            />
          )}
        </Field>
        <Field label={SEND_FIELDS.note} optional>
          {({ id, describedBy }) => (
            <Textarea
              id={id}
              aria-describedby={describedBy}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={NOTE_MAX}
              autoSize={{ minRows: 2, maxRows: 6 }}
              placeholder={SEND_FIELDS.notePlaceholder}
              disabled={sending}
            />
          )}
        </Field>
        <Field label={SEND_FIELDS.due} error={dueChoice === 'pick' ? undefined : errors.due}>
          {({ id, describedBy, invalid }) => (
            <Select
              id={id}
              describedBy={describedBy}
              invalid={invalid}
              value={dueChoice}
              onChange={(value) => {
                setDueChoice(value as DueChoice);
                setErrors((current) => ({ ...current, due: undefined }));
              }}
              options={DUE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
              disabled={sending}
            />
          )}
        </Field>
        {dueChoice === 'pick' ? (
          <Field label={SEND_FIELDS.date} required error={errors.due}>
            {({ id, describedBy, invalid }) => (
              <DatePicker
                id={id}
                describedBy={describedBy}
                invalid={invalid}
                value={picked}
                min={today}
                onChange={(value) => {
                  setPicked(value);
                  setErrors((current) => ({ ...current, due: undefined }));
                }}
                disabled={sending}
              />
            )}
          </Field>
        ) : null}
      </Section>
    </ResponsiveDialog>
  );
}
