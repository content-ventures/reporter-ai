'use client';
import { useCallback, useEffect, useState } from 'react';
import { Button, ButtonGroup, DataTable, EmptyState, ErrorState, Spinner } from '@content-ventures/design-system/v3';
import type { MemorySelection } from '@/domain/editorial-memory';
import type { MemoryLibrary } from '@/ports/editorial-memory';
import { usePeople } from '@/state';
import { useMemoryResource } from '@/state/use-memory-library';

export function MemorySelections({ onOpen, refresh }: { onOpen: (selection: MemorySelection) => void; refresh: number }) {
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]), cursor = cursors.at(-1), people = usePeople();
  const load = useCallback((port: MemoryLibrary) => port.selections({ cursor, limit: 25 }), [cursor]), resource = useMemoryResource(load);
  const { reload } = resource;
  useEffect(() => { reload(); }, [refresh, reload]);
  if (resource.error) return <ErrorState title="Não foi possível recuperar as seleções" description={resource.error} onRetry={resource.reload} />;
  if (!resource.data) return <Spinner label="Carregando seleções" />;
  return <DataTable label="Seleções salvas" rows={resource.data.items} rowKey={item => item.id} rowLabel={item => `Seleção de ${item.items.length} evidências`} onRowClick={onOpen}
    columns={[{ key: 'items', header: 'Seleção', pinned: true, render: item => `${item.items.length} evidências` },
      { key: 'actor', header: 'Salva por', render: item => people.data?.find(person => person.id === item.updatedBy)?.name ?? 'Usuário do cliente' },
      { key: 'date', header: 'Atualização', render: item => new Date(item.updatedAt).toLocaleString('pt-BR') },
      { key: 'revision', header: 'Revisão', render: item => item.revision }]}
    empty={<EmptyState title="Nenhuma seleção salva" description="Selecione evidências no banco e organize os trechos para escrever." />}
    footer={<ButtonGroup label="Páginas de seleções"><Button variant="secondary" disabled={cursors.length === 1} onClick={() => setCursors(current => current.slice(0, -1))}>Anterior</Button>
      <Button variant="secondary" disabled={!resource.data.nextCursor} onClick={() => setCursors(current => [...current, resource.data!.nextCursor!])}>Próxima</Button></ButtonGroup>} />;
}
