'use client';

import { useState } from 'react';
import {
  Alert,
  Button,
  ConfirmDialog,
  Drawer,
  Field,
  LinkButton,
  PageStack,
  Segmented,
  Textarea,
  toast,
  type SegmentOption,
} from '@content-ventures/design-system/v3';
import { expectedDraftChars, fitSections, sizeOf, type ArticleSize, type Brief, type ProductionId } from '@/domain';
import { useBrief } from '@/state';
import { formatCharacters, formatLaudas, formatSize, SIZE_OPTIONS } from '@/ui/format';

/**
 * "Editar pauta" (A08): orientação editorial, seções e tamanho of the production. The form
 * saves over the revision it was opened with: if the brief changed meanwhile (another tab,
 * another person), nothing is overwritten silently: the person sees it and either loads the
 * current brief or saves over it. The next "Gerar nova versão" follows the saved brief.
 */

const MAX_ANGLE_LENGTH = 600;

/** Section counts the size accepts (Curto 1–3, Padrão 2–5). */
function sectionOptions(size: ArticleSize): SegmentOption<string>[] {
  const { min, max } = sizeOf(size).sections;
  return Array.from({ length: max - min + 1 }, (_, index) => {
    const value = String(min + index);
    return { value, label: value };
  });
}

const SIZES: SegmentOption<ArticleSize>[] = SIZE_OPTIONS.map((option) => ({ value: option.value, label: option.label }));

type Form = { angle: string; sections: number; size: ArticleSize; base: number };

const formOf = (brief: Brief): Form => ({ angle: brief.angle ?? '', sections: brief.sections, size: brief.size, base: brief.revision });

const changed = (form: Form, brief: Brief) => form.angle.trim() !== (brief.angle ?? '').trim() || form.sections !== brief.sections || form.size !== brief.size;

export function BriefDrawer({ productionId, open, onClose }: { productionId: ProductionId; open: boolean; onClose: () => void }) {
  const editor = useBrief(productionId);
  const { brief, conflict } = editor;
  const [form, setForm] = useState<Form | null>(null);
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    setForm(open && brief ? formOf(brief) : null);
    editor.clearConflict();
  }
  const current = form ?? (brief ? formOf(brief) : null);
  const dirty = Boolean(current && brief && changed(current, brief));
  const [discarding, setDiscarding] = useState(false);

  if (!brief || !current) return null;
  const spec = sizeOf(current.size);
  // A material that cannot fill the size gives all it has (never padded): said before saving.
  const expected = editor.charsAvailable ? expectedDraftChars(current.size, editor.charsAvailable) : undefined;
  const sizeHint =
    expected && !expected.reachesRange
      ? `O material rende ≈ ${formatLaudas(expected.chars)} (${formatCharacters(expected.chars)}). O texto sai com isso.`
      : `Até ${formatCharacters(spec.maxChars)}`;
  const update = (patch: Partial<Form>) => setForm({ ...current, ...patch });

  async function save() {
    if (!current) return;
    const angle = current.angle.trim();
    const result = await editor.save({ sections: current.sections, size: current.size, ...(angle ? { angle } : {}) }, current.base);
    if (result.ok) {
      onClose();
      toast('Pauta salva');
    }
  }

  // After a conflict, saving again means "over the brief as it is now".
  const overwrite = () => {
    if (brief) setForm({ ...current, base: brief.revision });
    editor.clearConflict();
  };
  const reload = () => {
    if (brief) setForm(formOf(brief));
    editor.clearConflict();
  };

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        title="Pauta"
        dismissible={!dirty}
        footer={
          <>
            <Button onClick={() => (dirty ? setDiscarding(true) : onClose())}>Cancelar</Button>
            <Button variant="primary" loading={editor.saving} disabled={!dirty || conflict} onClick={() => void save()}>
              Salvar pauta
            </Button>
          </>
        }
      >
        <PageStack>
          {conflict ? (
            <Alert
              tone="attention"
              title="A pauta mudou depois que você abriu"
              action={
                <>
                  <LinkButton onClick={reload}>Carregar a atual</LinkButton>
                  <LinkButton onClick={overwrite}>Manter a minha</LinkButton>
                </>
              }
            >
              {`Atual: ${formatSize(brief.size)} · ${brief.sections} seções${brief.angle ? ` · ${brief.angle}` : ''}`}
            </Alert>
          ) : null}
          <Field label="Orientação editorial" optional>
            {({ id }) => (
              <Textarea
                id={id}
                autoSize={{ minRows: 3, maxRows: 8 }}
                maxLength={MAX_ANGLE_LENGTH}
                value={current.angle}
                onChange={(event) => update({ angle: event.target.value })}
              />
            )}
          </Field>
          <Field label="Tamanho do artigo" hint={sizeHint}>
            {() => (
              <Segmented
                label="Tamanho do artigo"
                options={SIZES}
                value={current.size}
                onChange={(size) => update({ size, sections: fitSections(size, current.sections) })}
                size="sm"
              />
            )}
          </Field>
          <Field label="Seções" hint={`Introdução + ${current.sections} seções`}>
            {() => (
              <Segmented
                label="Seções depois da introdução"
                options={sectionOptions(current.size)}
                value={String(current.sections)}
                onChange={(value) => update({ sections: Number(value) })}
                size="sm"
              />
            )}
          </Field>
        </PageStack>
      </Drawer>
      <ConfirmDialog
        open={discarding}
        onClose={() => setDiscarding(false)}
        title="Descartar as alterações da pauta?"
        confirmLabel="Descartar alterações"
        tone="danger"
        onConfirm={() => {
          setDiscarding(false);
          onClose();
        }}
      />
    </>
  );
}
