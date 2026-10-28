'use client';
import { useMemo } from 'react';
import { DescriptionList, Drawer, ErrorState, Panel, Section, Spinner } from '@content-ventures/design-system/v3';
import { memoryUsedArticle, type MemoryVersionUse } from '@/domain/editorial-memory-reading';
import { useVersion } from '@/state';
import { ArticleReading } from '@/features/review/article-reading';

const noAction = () => undefined;
export function MemoryUsedVersion({ occurrence, open, onClose }: { occurrence: MemoryVersionUse; open: boolean; onClose: () => void }) {
  return <Drawer open={open} title={`Artigo · versão ${occurrence.article.number}`} size="lg" onClose={onClose}>
    <UsedArticle occurrence={occurrence} />
  </Drawer>;
}
function UsedArticle({ occurrence }: { occurrence: MemoryVersionUse }) {
  const version = useVersion(occurrence.article.versionId);
  const recorded = useMemo(() => [{ blockId: occurrence.blockId, from: occurrence.from, to: occurrence.to }], [occurrence]);
  const focus = useMemo(() => ({ blockId: occurrence.blockId, nonce: 0 }), [occurrence.blockId]);
  if (version.status === 'error') return <ErrorState title="Não foi possível abrir esta versão" description={version.error.message} onRetry={version.retry} />;
  if (!version.data) return <Spinner label="Carregando a versão utilizada" />;
  const body = memoryUsedArticle(occurrence, version.data);
  if (!body) return <ErrorState title="A versão não corresponde ao uso registrado" description="Atualize o histórico antes de abrir novamente." />;
  return <Panel><Section>
    <DescriptionList items={[{ label: 'Versão utilizada', value: version.data.label },
      { label: 'Uso registrado', value: new Date(occurrence.at).toLocaleString('pt-BR') }]} />
    <ArticleReading body={body} label={`Artigo na versão ${occurrence.article.number}`} anchors={recorded} focus={focus} canPoint={false} onPoint={noAction} onReturnWith={noAction} />
  </Section></Panel>;
}
