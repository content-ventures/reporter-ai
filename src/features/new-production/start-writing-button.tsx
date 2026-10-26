'use client';

import { useRef, useState } from 'react';
import { useWorkspaceRouter as useRouter } from '@/ui/workspace-navigation';
import { Button, toast } from '@content-ventures/design-system/v3';
import { FileText } from '@content-ventures/design-system/v3/icons';
import { DEFAULT_ARTICLE_SIZE, DEFAULT_SECTIONS } from '@/domain';
import { useCan, useCommands } from '@/state';
import { pieceHref } from '@/ui/routes';
import { notifyRefusal } from '@/ui/permission-dialog';

/** A user action creates one blank, persisted article and opens the existing R1 studio. */
export function StartWritingButton() {
  const router = useRouter();
  const commands = useCommands();
  const allowed = useCan('production.create');
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  if (!allowed) return null;

  async function start() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    let opened = false;
    try {
      const result = await commands.production.createBlank({
        title: 'Artigo sem título',
        brief: { size: DEFAULT_ARTICLE_SIZE, sections: DEFAULT_SECTIONS },
      });
      if (!result.ok) {
        notifyRefusal('Não foi possível abrir o editor', result.refusal);
        return;
      }
      router.push(pieceHref(result.value.productionId, 'article'));
      opened = true;
    } catch {
      toast('Não foi possível abrir o editor', { tone: 'error' });
    } finally {
      if (!opened) {
        pending.current = false;
        setBusy(false);
      }
    }
  }

  return <Button icon={FileText} loading={busy} disabled={busy} onClick={() => void start()}>Escrever do zero</Button>;
}
