'use client';

import { Button, Dialog, IconButton, MediaFrame, MetaList } from '@content-ventures/design-system/v3';
import { ChevronLeft, ChevronRight } from '@content-ventures/design-system/v3/icons';

export type TemplatePreviewFrame = { key: string; label: string; src?: string; width?: number; height?: number };
export type TemplateInspection = { templateId: string; frames: readonly TemplatePreviewFrame[]; index: number };

/** Sibling of the model Drawer, never its React descendant: Escape belongs to this layer only. */
export function TemplatePageViewer({
  inspection,
  name,
  ratio,
  onIndex,
  onClose,
}: {
  inspection: TemplateInspection | null;
  name: string;
  ratio: string;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const index = inspection?.index ?? 0;
  const frames = inspection?.frames ?? [];
  const selected = frames[index];
  return (
    <Dialog
      open={Boolean(selected)}
      onClose={onClose}
      title={selected ? `${selected.label} · ${name}` : 'Prévia'}
      description={selected?.width ? `Prévia · ${selected.width} × ${selected.height} px · PNG` : undefined}
      size="lg"
      footerStart={selected ? (
        <>
          <IconButton label="Página anterior" icon={ChevronLeft} disabled={index <= 0} onClick={() => onIndex(index - 1)} />
          <MetaList label="Páginas da prévia" separator="" wrap={false} items={[{ value: `${index + 1} de ${frames.length}`, numeric: true }]} />
          <IconButton label="Próxima página" icon={ChevronRight} disabled={index >= frames.length - 1} onClick={() => onIndex(index + 1)} />
        </>
      ) : undefined}
      footer={<Button onClick={onClose}>Voltar ao modelo</Button>}
    >
      {selected ? (
        <MediaFrame
          ratio={ratio}
          src={selected.src}
          alt={`${selected.label} no modelo ${name}`}
          fit="contain"
          radius="none"
          // Reserve the DS dialog margins, header, body padding and two-row mobile footer.
          // The ceiling also respects the DS dialog's 760px maximum; keep the PNG unchanged.
          maxHeight="clamp(1px, calc(100dvh - 320px), 540px)"
        />
      ) : null}
    </Dialog>
  );
}
