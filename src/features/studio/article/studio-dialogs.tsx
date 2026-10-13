'use client';

import { useMemo, useState } from 'react';
import { Button, ConfirmDialog, Drawer, EmptyState, List, ListItem } from '@content-ventures/design-system/v3';
import { Heading2, Heading3, RotateCcw, Sparkles } from '@content-ventures/design-system/v3/icons';
import type { VersionView } from '@/domain';
import { BriefDrawer } from '@/features/material/brief-drawer';
import { formatLaudas, formatListDateTime } from '@/ui/format';
import { usePerson } from '@/ui/person-avatar';
import { Provenance } from '@/ui/provenance';
import { RunTrace } from '@/ui/run-trace';
import { SendForApprovalDialog } from '@/ui/send-for-approval-dialog';
import { useStudio } from './studio-context';
import { RewriteDialog } from './studio-footer';
import { historyTitle } from './studio-model';

/**
 * What opens over the studio from ⋯ and the primary, one at a time (`panes.dialog`): the pre-send
 * dialog, "Editar pauta", "Ver estrutura", "Histórico de versões", "Como a IA escreveu" and
 * "Reescrever o artigo do zero?" (CONTRACT §3.8, COPY §2.7 and §2.8).
 */
export function StudioDialogs() {
  const studio = useStudio();
  const { panes, approval } = studio;
  const { dialog, closeDialog } = panes;
  return (
    <>
      {approval ? (
        <SendForApprovalDialog
          open={dialog === 'send'}
          onClose={closeDialog}
          productionId={studio.production.id}
          approval={approval}
          pieceLabel="artigo"
          onJump={(target) => studio.actions.jumpTo(target)}
          onMarkReviewed={studio.actions.markTextReviewed}
          prepare={studio.prepareSend}
        />
      ) : null}
      <BriefDrawer productionId={studio.production.id} open={dialog === 'brief'} onClose={closeDialog} />
      <StructureDrawer open={dialog === 'structure'} onClose={closeDialog} />
      <HistoryDrawer open={dialog === 'history'} onClose={closeDialog} />
      <TraceDrawer open={dialog === 'trace'} onClose={closeDialog} />
      <RewriteDialog open={dialog === 'rewrite'} onClose={closeDialog} />
    </>
  );
}

/** "Ver estrutura": the headings of the text on screen, each one jumping to its place. */
function StructureDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const studio = useStudio();
  const { outline } = studio.facts;
  return (
    <Drawer open={open} onClose={onClose} title="Estrutura">
      <List label="Estrutura do artigo" empty="A estrutura aparece depois que a IA escreve o texto." framed={false}>
        {outline.map((entry) => (
          <ListItem
            key={entry.blockId}
            icon={entry.level === 2 ? Heading2 : Heading3}
            title={entry.text || 'Sem texto'}
            density="sm"
            onClick={() => {
              onClose();
              studio.panes.showText();
              studio.actions.scrollToBlock(entry.blockId);
            }}
          />
        ))}
      </List>
    </Drawer>
  );
}

/** "Como a IA escreveu": the steps of the run that wrote the text on screen (admins also see the model). */
function TraceDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const studio = useStudio();
  const run = studio.generation.run;
  return (
    <Drawer open={open} onClose={onClose} title="Como a IA escreveu">
      {run ? (
        <>
          <RunTrace run={run} label="Etapas" announce={false} />
          {studio.isAdmin ? <Provenance run={run} /> : null}
        </>
      ) : (
        <EmptyState icon={Sparkles} title="Este texto não foi escrito pela IA" />
      )}
    </Drawer>
  );
}

/** "Histórico de versões": each version named by what happened to it, with "Restaurar". */
function HistoryDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const studio = useStudio();
  const versions = useMemo(() => [...studio.piece.versions].reverse(), [studio.piece.versions]);
  const [restoring, setRestoring] = useState<VersionView | null>(null);
  return (
    <>
      <Drawer open={open} onClose={onClose} size="lg" title="Histórico de versões">
        <List label="Versões do artigo" empty="Nenhuma versão ainda" framed={false}>
          {studio.draft.dirty ? <ListItem key="current" title="Texto atual" description="Ainda sem versão salva" density="sm" /> : null}
          {versions.map((version) => (
            <HistoryRow key={version.id} version={version} onRestore={() => setRestoring(version)} />
          ))}
        </List>
      </Drawer>
      <ConfirmDialog
        open={restoring !== null}
        onClose={() => setRestoring(null)}
        title="Restaurar esta versão?"
        description="O texto atual fica no histórico."
        confirmLabel="Restaurar"
        onConfirm={() => (restoring ? studio.actions.restoreVersion(restoring.id) : undefined)}
      />
    </>
  );
}

function HistoryRow({ version, onRestore }: { version: VersionView; onRestore: () => void }) {
  const studio = useStudio();
  const author = usePerson(version.createdBy);
  const decider = usePerson(version.decision?.by);
  const request = studio.piece.pendingReview;
  const assignee = usePerson(request?.subject.versionId === version.id ? request.assigneeId : undefined);
  const restoredFrom = version.restoredFrom ? studio.piece.versions.find((entry) => entry.id === version.restoredFrom) : undefined;
  const isCurrent = version.isLatest && !studio.draft.dirty;
  const nameOf = (id: string) => (id === version.decision?.by ? decider?.name : id === version.createdBy ? author?.name : undefined) ?? '';
  const title = historyTitle(version, {
    nameOf,
    ...(assignee ? { sentTo: assignee.name } : {}),
    ...(restoredFrom ? { restoredFromDate: formatListDateTime(restoredFrom.createdAt).split(' ')[0] ?? '' } : {}),
  });
  return (
    <ListItem
      title={title}
      description={[isCurrent ? 'Texto atual' : null, formatListDateTime(version.createdAt), formatLaudas(version.characters)].filter(Boolean).join(' · ')}
      density="sm"
      actions={
        isCurrent || !studio.canEdit ? undefined : (
          <Button size="sm" variant="ghost" icon={RotateCcw} disabled={studio.generation.active || Boolean(studio.refusal)} onClick={onRestore}>
            Restaurar
          </Button>
        )
      }
    />
  );
}
