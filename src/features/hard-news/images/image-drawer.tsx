'use client';

import { useState } from 'react';
import {
  Alert,
  Button,
  DescriptionList,
  Drawer,
  Field,
  Input,
  MediaFrame,
  PageStack,
  Select,
  Textarea,
} from '@content-ventures/design-system/v3';
import type { ArchiveImage } from '@/domain/hard-news';
import { formatDate, plural } from '@/ui/format';
import { isLicense, LICENSE_OPTIONS } from './images-model';

/**
 * Caption, credit and license of one archive image (F2.9, REQ-2.9). Caption and credit are
 * required; an image whose rights are still to be confirmed is kept, marked, and cannot go into an
 * article. The parent keys this by image, so each opening starts from the saved values.
 */
export function ImageDrawer({ image, open, onClose, onSave }: {
  image: ArchiveImage;
  open: boolean;
  onClose: () => void;
  onSave: (image: ArchiveImage) => void;
}) {
  const [caption, setCaption] = useState(image.caption);
  const [credit, setCredit] = useState(image.credit);
  const [license, setLicense] = useState(image.license);
  const [tried, setTried] = useState(false);
  const dirty = caption !== image.caption || credit !== image.credit || license !== image.license;
  const missingCaption = !caption.trim();
  const missingCredit = !credit.trim();

  function save() {
    setTried(true);
    if (missingCaption || missingCredit) return;
    onSave({ ...image, caption: caption.trim(), credit: credit.trim(), license });
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      dismissible={!dirty}
      size="md"
      title="Editar imagem"
      footer={(
        <>
          <Button variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button variant="primary" onClick={save}>Salvar imagem</Button>
        </>
      )}
    >
      <PageStack>
        <MediaFrame src={image.src} alt={caption || image.caption} ratio={`${image.width}/${image.height}`} fit="contain" maxHeight={320} />
        <Field label="Legenda" required error={tried && missingCaption ? 'Escreva a legenda.' : undefined}>
          {({ id, describedBy, invalid }) => (
            <Textarea id={id} aria-describedby={describedBy} invalid={invalid} rows={2} autoSize value={caption} onChange={(event) => setCaption(event.target.value)} />
          )}
        </Field>
        <Field label="Crédito" required error={tried && missingCredit ? 'Informe o crédito.' : undefined}>
          {({ id, describedBy, invalid }) => (
            <Input id={id} aria-describedby={describedBy} invalid={invalid} value={credit} placeholder="Ex.: Clara Souto/Portal do Pescado" onChange={(event) => setCredit(event.target.value)} />
          )}
        </Field>
        <Field label="Licença">
          {({ id, describedBy }) => (
            <Select id={id} describedBy={describedBy} value={license} options={LICENSE_OPTIONS} onChange={(value) => { if (isLicense(value)) setLicense(value); }} />
          )}
        </Field>
        {license === 'pending' ? (
          <Alert tone="warning" title="Não pode ir para artigos">Confirme os direitos e troque a licença.</Alert>
        ) : null}
        <DescriptionList
          items={[
            { label: 'Tamanho', value: `${image.width} × ${image.height} px`, numeric: true },
            { label: 'Data', value: image.takenOn ? formatDate(image.takenOn) : undefined, state: image.takenOn ? undefined : 'empty', numeric: true },
            { label: 'Usada em', value: image.uses > 0 ? plural(image.uses, 'matéria', 'matérias') : 'Nenhuma matéria' },
            { label: 'Temas', value: image.tags.length > 0 ? image.tags.join(', ') : undefined, state: image.tags.length > 0 ? undefined : 'empty' },
          ]}
        />
      </PageStack>
    </Drawer>
  );
}
