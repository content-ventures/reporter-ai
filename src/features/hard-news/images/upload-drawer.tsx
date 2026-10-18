'use client';

import { useState } from 'react';
import { Button, Drawer, Dropzone } from '@content-ventures/design-system/v3';
import type { ArchiveImage } from '@/domain/hard-news';
import { addUploads, UPLOAD_PREFIX } from './use-image-bank';

const ACCEPT = 'image/jpeg,image/png,image/webp';

/** The photo's size, read from the file itself (no DOM); unreadable files take a common 4:3. */
async function sizeOf(file: File): Promise<{ width: number; height: number }> {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return { width: 1600, height: 1200 };
  }
}

/** "foto_porto-itajai.jpg" → "Foto porto itajai". */
function captionOf(name: string): string {
  const base = name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
  return base ? base.charAt(0).toLocaleUpperCase('pt-BR') + base.slice(1) : 'Foto enviada';
}

/**
 * "Enviar fotos": the files enter the archive with rights to confirm (no credit, no license yet), so
 * none goes into an article before someone completes it (REQ-2.9).
 */
export function UploadDrawer({ open, onClose, onSent }: {
  open: boolean;
  onClose: () => void;
  onSent: (images: ArchiveImage[]) => void;
}) {
  const [refused, setRefused] = useState(0);

  async function take(files: File[], rejected: unknown[]) {
    setRefused(rejected.length);
    if (files.length === 0) return;
    const stamp = Date.now().toString(36);
    const images = await Promise.all(files.map(async (file, index): Promise<ArchiveImage> => ({
      id: `${UPLOAD_PREFIX}${stamp}-${index}`,
      src: URL.createObjectURL(file),
      ...(await sizeOf(file)),
      caption: captionOf(file.name),
      credit: '',
      license: 'pending',
      tags: [],
      uses: 0,
    })));
    addUploads(images);
    onSent(images);
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      size="md"
      title="Enviar fotos"
      footer={<Button variant="secondary" onClick={onClose}>Fechar</Button>}
    >
      <Dropzone
        multiple
        accept={ACCEPT}
        spec="JPG, PNG ou WEBP · até 25 MB"
        invalid={refused > 0}
        error={refused > 0 ? `${refused === 1 ? '1 arquivo recusado' : `${refused} arquivos recusados`}: use JPG, PNG ou WEBP de até 25 MB.` : undefined}
        onFiles={(files, rejected) => void take(files, rejected)}
      />
    </Drawer>
  );
}
