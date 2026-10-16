'use client';

import { useState } from 'react';
import { Avatar, Button, CardHeader, Dropzone, LinkButton, ResponsiveDialog, toast } from '@content-ventures/design-system/v3';
import { IMAGE_LIMITS, validateImageFile } from '@/domain';
import type { SessionMember } from '@/ports';
import { useCommands } from '@/state';
import { useFilePreview } from '@/ui/file-preview';

/** "Trocar foto": pick, see it as the round avatar, then save. The adapter squares it. */
export function ProfilePhotoDialog({ member, open, onClose }: { member: SessionMember; open: boolean; onClose: () => void }) {
  const commands = useCommands();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const preview = useFilePreview(file);

  const close = () => {
    if (saving) return;
    setFile(null);
    setError(undefined);
    onClose();
  };
  const choose = (files: File[], rejected: { file: File }[]) => {
    const picked = files[0] ?? rejected[0]?.file;
    if (!picked) return;
    const check = validateImageFile({ name: picked.name, type: picked.type, size: picked.size });
    setFile(check.ok ? picked : null);
    setError(check.ok ? undefined : check.refusal.message);
  };
  const save = async () => {
    if (!file || saving) return;
    setSaving(true);
    try {
      const result = await commands.session.setAvatar({ file, fileName: file.name });
      if (!result.ok) {
        toast('Foto não salva', { tone: 'error', description: result.refusal.message });
        return;
      }
      toast('Foto atualizada');
      setFile(null);
      onClose();
    } finally { setSaving(false); }
  };

  return (
    <ResponsiveDialog open={open} onClose={close} title="Foto de perfil" size="sm" dirty={Boolean(file)}
      footer={<>
        <Button variant="ghost" onClick={close} disabled={saving}>Cancelar</Button>
        <Button variant="primary" onClick={() => void save()} loading={saving} disabled={!file}>Salvar foto</Button>
      </>}>
      {file ? (
        <CardHeader title={member.name} leading={<Avatar name={member.name} src={preview} size="xl" />}
          actions={<LinkButton size="sm" onClick={() => setFile(null)} disabled={saving}>Escolher outra</LinkButton>} />
      ) : (
        <Dropzone accept={IMAGE_LIMITS.accept} maxSize={IMAGE_LIMITS.maxBytes} spec={IMAGE_LIMITS.hint}
          title="Arraste a foto aqui ou escolha um arquivo" invalid={Boolean(error)} error={error} onFiles={choose} />
      )}
    </ResponsiveDialog>
  );
}
