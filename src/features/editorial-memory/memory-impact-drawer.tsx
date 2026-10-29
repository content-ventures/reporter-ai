'use client';
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, ButtonGroup, DataTable, DescriptionList, Drawer, EmptyState, ErrorState, IconButton, Panel, Section, Spinner } from '@content-ventures/design-system/v3';
import { RotateCw } from '@content-ventures/design-system/v3/icons';
import type { MemorySelection } from '@/domain/editorial-memory';
import type { MemoryImpactScope, MemoryImpactTarget, MemoryLibrary } from '@/ports/editorial-memory';
import { useMemoryResource } from '@/state/use-memory-library';
import { useWorkspaceRouter } from '@/ui/workspace-navigation';
import { pieceHref } from '@/ui/routes';

export function MemoryImpactDrawer({ scope, open, onClose, onSelection }: { scope: MemoryImpactScope; open: boolean; onClose: () => void; onSelection: (selection: MemorySelection) => void }) {
  const router = useWorkspaceRouter(), [cursors, setCursors] = useState<(string | undefined)[]>([undefined]), cursor = cursors.at(-1);
  const { kind, id } = scope;
  const load = useCallback((port: MemoryLibrary) => port.correctionImpact({ kind, id }, { cursor, limit: 25 }), [kind, id, cursor]);
  // Keep the inspected page stable while another sibling dialog reviews a selection.
  const resource = useMemoryResource(load, 0, open), page = resource.data;
  const binding = useMemo(() => ({ port: resource.port, open }), [resource.port, open]), active = useRef<typeof binding>(undefined);
  useLayoutEffect(() => { if (binding.open) active.current = binding; return () => { if (active.current === binding) active.current = undefined; }; }, [binding]);
  type Attempt = { binding: typeof binding; id: string };
  const pending = useRef<Attempt>(undefined), [busy, setBusy] = useState<Attempt>(), [error, setError] = useState<{ binding: typeof binding; message: string }>();
  const locked = busy?.binding === binding;
  const restart = () => { setCursors([undefined]); setError(undefined); resource.reload(); };
  async function openTarget(target: MemoryImpactTarget) {
    if (!binding.port || active.current !== binding || pending.current?.binding === binding) return;
    if (target.kind === 'production') { router.push(pieceHref(target.id, 'article')); return; }
    const attempt = { binding, id: target.id }; pending.current = attempt; setBusy(attempt); setError(undefined);
    try { const selected = await binding.port.selection(target.id); if (active.current === binding) onSelection(selected); }
    catch (failure) { if (active.current === binding) setError({ binding, message: failure instanceof Error ? failure.message : 'Não foi possível abrir esta seleção.' }); }
    finally { if (pending.current === attempt) pending.current = undefined; setBusy(current => current === attempt ? undefined : current); }
  }
  return <Drawer open={open} onClose={onClose} title="Impacto da correção" size="lg"
    actions={<IconButton label="Atualizar impacto" icon={RotateCw} variant="ghost" disabled={locked} onClick={restart} />}
    footer={<ButtonGroup label="Páginas do impacto"><Button variant="secondary" disabled={locked || cursors.length === 1} onClick={() => setCursors(current => current.slice(0, -1))}>Anterior</Button>
      <Button variant="secondary" disabled={locked || !page?.nextCursor} onClick={() => setCursors(current => [...current, page!.nextCursor!])}>Próxima</Button></ButtonGroup>}>
    {resource.error ? <ErrorState title="Não foi possível consultar o impacto" description={resource.error} onRetry={restart} /> : !page ? <Spinner label="Consultando referências anteriores" /> : <Panel><Section title="Referências a revisar" meta={`${page.total} destinos`}>
      {error?.binding === binding && <Alert tone="danger" title={error.message} />}
      {locked && <Spinner label="Abrindo seleção" />}
      <DescriptionList items={[{ label: kind === 'material' ? 'Revisão atual do material' : 'Revisão atual da evidência', value: page.currentRevision }]} />
      <DataTable label="Destinos afetados" rows={page.items} rowKey={target => `${target.kind}:${target.id}`} rowLabel={target => target.kind === 'production' ? target.title : `Seleção de ${target.totalEvidence} evidências · revisão ${target.revision}`} onRowClick={target => void openTarget(target)}
        columns={[{ key: 'target', header: 'Destino', pinned: true, render: target => target.kind === 'production' ? target.title : `Seleção de ${target.totalEvidence} evidências` },
          { key: 'kind', header: 'Tipo', render: target => target.kind === 'production' ? 'Pauta' : 'Seleção' },
          { key: 'selection', header: 'Na seleção', render: target => target.kind === 'production' ? target.selectedEvidence : target.changedEvidence },
          { key: 'draft', header: 'No rascunho', render: target => target.kind === 'production' ? target.draftEvidence : '—' },
          { key: 'updated', header: 'Atualização', render: target => new Date(target.updatedAt).toLocaleString('pt-BR') }]}
        empty={<EmptyState title="Sem referências a revisões anteriores" />} />
    </Section></Panel>}
  </Drawer>;
}
