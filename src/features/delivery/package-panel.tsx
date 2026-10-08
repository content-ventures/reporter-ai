'use client';

import { useState } from 'react';
import {
  Badge,
  Button,
  ButtonLink,
  FormatFrame,
  List,
  ListGroup,
  ListItem,
  ListItemSkeleton,
  MiddleEllipsis,
  Panel,
  Section,
  Tooltip,
  formatBytes,
} from '@content-ventures/design-system/v3';
import { Download, FileArchive, FileImage, FileText, ListChecks, RotateCw, type LucideIcon } from '@content-ventures/design-system/v3/icons';
import type { DeliveryItemView, PackageFile } from '@/ports';
import { formatListDateTime, plural } from '@/ui/format';
import { StatusBadge } from '@/ui/status-badge';
import { fileCaption, groupFiles, imageCaption, linkedImageAddress, type FileProgress } from './delivery-model';
import type { PackageController } from './use-package';

function fileIcon(file: PackageFile): LucideIcon {
  if (file.kind === 'manifest') return ListChecks;
  if (file.format === 'zip') return FileArchive;
  if (file.kind === 'image' || file.format === 'png') return FileImage;
  return FileText;
}

/** Article image: a thumbnail of the file itself (or of the linked address), in its proportion. */
function imageThumb(file: PackageFile, progress: FileProgress) {
  const asset = file.image?.asset;
  if (!file.image) return undefined;
  const src = progress.state === 'ready' ? progress.href : asset?.origin.type === 'url' ? asset.origin.url : undefined;
  const format = asset?.width && asset.height ? { w: asset.width, h: asset.height } : undefined;
  return <FormatFrame src={src} format={format} max={48} />;
}

/** "aprovado por Pedro Alves · 09/10 · 14:32". */
function approvalLine(item: DeliveryItemView): string {
  return [item.approvedBy ? `aprovado por ${item.approvedBy.name}` : 'aprovado', item.approvedAt ? formatListDateTime(item.approvedAt) : null]
    .filter(Boolean)
    .join(' · ');
}

function progressOf(file: PackageFile, progress: Readonly<Record<string, FileProgress>>): FileProgress {
  return progress[file.fileName] ?? (file.available ? { state: 'pending' } : { state: 'unavailable', reason: file.unavailableReason ?? 'Formato ainda não disponível.' });
}

type FileItemProps = {
  file: PackageFile;
  progress: FileProgress;
  retrying: boolean;
  anchorRef: PackageController['anchorRef'];
  onRetry: (file: PackageFile) => void;
};

function FileItem({ file, progress, retrying, anchorRef, onRetry }: FileItemProps) {
  const icon = fileIcon(file);
  const leading = imageThumb(file, progress);
  const caption = file.image ? imageCaption(file) : fileCaption(file);
  // Long image names keep their end (number and extension) when the row is narrow.
  const title = file.image ? <MiddleEllipsis text={file.fileName} tail={12} /> : file.fileName;
  switch (progress.state) {
    case 'unavailable':
      // A linked image is named by its address: it stays where it is, outside the package.
      return <ListItem leading={leading} icon={icon} title={linkedImageAddress(file) ?? title} description={progress.reason} disabled />;
    case 'pending':
      return (
        <ListItem
          leading={leading}
          icon={icon}
          title={title}
          description={caption}
          meta={<StatusBadge kind="run" status="queued" label="Na fila" variant="text" size="sm" />}
        />
      );
    case 'building':
      return (
        <ListItem
          leading={leading}
          icon={icon}
          title={title}
          description={caption}
          meta={<StatusBadge kind="run" status="running" label="Gerando" size="sm" />}
        />
      );
    case 'failed':
      return (
        <ListItem
          leading={leading}
          icon={icon}
          title={title}
          description={progress.error.message}
          meta={
            <Badge tone="red" variant="text" size="sm">
              Falhou
            </Badge>
          }
          actions={
            <Button size="sm" icon={RotateCw} loading={retrying} onClick={() => onRetry(file)}>
              Tentar de novo
            </Button>
          }
        />
      );
    case 'ready':
      return (
        <ListItem
          leading={leading}
          icon={icon}
          title={title}
          description={caption}
          meta={progress.bytes !== undefined ? formatBytes(progress.bytes) : undefined}
          actions={
            <Tooltip content="Baixar">
              <ButtonLink
                ref={anchorRef(file.fileName)}
                href={progress.href}
                download={file.fileName}
                aria-label={`Baixar ${file.fileName}`}
                variant="ghost"
                size="sm"
                icon={Download}
              />
            </Tooltip>
          }
        />
      );
  }
}

export type PackagePanelProps = {
  pkg: PackageController;
  items: readonly DeliveryItemView[];
  onRetry: (file: PackageFile) => Promise<void>;
};

/**
 * "Pacote": one row per file of the exact package, grouped by approved version ("Artigo v4 ·
 * aprovado por Pedro Alves · 09/10 · 14:32"), each row with its own progress (Na fila →
 * Gerando → size + download), retry on failure, and the formats still to come disabled with
 * the reason. Article images follow the article files with a thumbnail, where the article uses
 * them, credit and origin; a linked image stays outside the package ("Link externo", with why).
 * The rendered slides show at the top of the page (DeliveredPieces).
 */
export function PackagePanel({ pkg, items, onRetry }: PackagePanelProps) {
  const [retrying, setRetrying] = useState<string | null>(null);
  const files = pkg.plan?.files ?? [];
  const groups = groupFiles(files, items);

  const meta =
    pkg.status === 'ready'
      ? [plural(pkg.total, 'arquivo', 'arquivos'), pkg.bytes > 0 ? formatBytes(pkg.bytes) : null].filter(Boolean).join(' · ')
      : pkg.plan
        ? `Preparando · ${pkg.done} de ${pkg.total}`
        : undefined;

  async function retry(file: PackageFile) {
    setRetrying(file.fileName);
    try {
      await onRetry(file);
    } finally {
      setRetrying(null);
    }
  }


  return (
    <Panel padding="lg">
      <Section title="Pacote" meta={pkg.failed > 0 ? plural(pkg.failed, 'arquivo falhou', 'arquivos falharam') : meta} metaTone={pkg.failed > 0 ? 'missing' : 'muted'}>
        {pkg.plan ? (
          <List label="Arquivos do pacote" framed={false}>
            {groups.map((group) => (
              <ListGroup key={group.id} label={group.label} meta={group.item ? approvalLine(group.item) : undefined}>
                {group.files.map((file) => (
                  <FileItem
                    key={file.fileName}
                    file={file}
                    progress={progressOf(file, pkg.progress)}
                    retrying={retrying === file.fileName}
                    anchorRef={pkg.anchorRef}
                    onRetry={retry}
                  />
                ))}
              </ListGroup>
            ))}
          </List>
        ) : (
          <List label="Arquivos do pacote" framed={false}>
            <ListItemSkeleton />
            <ListItemSkeleton />
            <ListItemSkeleton />
            <ListItemSkeleton />
          </List>
        )}
      </Section>
    </Panel>
  );
}
