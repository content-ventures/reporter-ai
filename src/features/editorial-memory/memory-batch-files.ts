import type { MemoryBatchFile } from '@/ports/editorial-memory-batch';

export const batchFailureMessage = (failure: unknown) => failure instanceof TypeError ? 'A conexão falhou. Tente novamente.' : failure instanceof Error ? failure.message : 'Não foi possível concluir. Tente novamente.';

/** Hash bounded files; unsupported/oversize entries still belong in the reconciliation report. */
export async function describeBatchFile(file: File): Promise<MemoryBatchFile> {
  const extension = file.name.split('.').at(-1)?.toLowerCase();
  const delimiter = extension === 'csv' ? ',' : extension === 'tsv' ? '\t' : null;
  if (file.size > 1048576 || !file.size || !['txt', 'md', 'srt', 'vtt', 'csv', 'tsv'].includes(extension ?? ''))
    return { name: file.name, size: file.size, checksum: null, delimiter };
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return { name: file.name, size: file.size, checksum: Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join(''), delimiter };
}
