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
import { expectedDraftWords, LENGTH_TARGETS, MAX_SECTIONS, MIN_SECTIONS, type ArticleLength, type Brief, type ProductionId } from '@/domain';
import { useBrief } from '@/state';
import { formatCount } from '@/ui/format';

/**
 * "Editar pauta" (A08): orientação editorial, seções e extensão of the production. The form
 * saves over the revision it was opened with: if the brief changed meanwhile (another tab,
 * another person), nothing is overwritten silently: the person sees it and either loads the
 * current brief or saves over it. The next "Gerar nova versão" follows the saved brief.
 */

const MAX_ANGLE_LENGTH = 600;

const SECTIONS: SegmentOption<string>[] = Array.from({ length: MAX_SECTIONS - MIN_SECTIONS + 1 }, (_, index) => {
  const value = String(MIN_SECTIONS + index);
  return { value, label: value };
});

const LENGTHS: SegmentOption<ArticleLength>[] = (Object.keys(LENGTH_TARGETS) as ArticleLength[]).map((length) => ({
  value: length,
  label: LENGTH_TARGETS[length].label,
}));

type Form = { angle: string; sections: number; length: ArticleLength; base: number };

const formOf = (brief: Brief): Form => ({ angle: brief.angle ?? '', sections: brief.sections, length: brief.length, base: brief.revision });

const changed = (form: Form, brief: Brief) => form.angle.trim() !== (brief.angle ?? '').trim() || form.sections !== brief.sections || form.length !== brief.length;

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
  const target = LENGTH_TARGETS[current.length];
  // A material that cannot reach the length gives all it has (never invented text): said before saving.
  const expected = editor.wordsAvailable ? expectedDraftWords(current.length, editor.wordsAvailable) : undefined;
  const lengthHint =
    expected && !expected.reachesTarget ? `O material rende ≈ ${formatCount(expected.words)} palavras` : `${formatCount(target.min)}–${formatCount(target.max)} palavras`;
  const update = (patch: Partial<Form>) => setForm({ ...current, ...patch });

  async function save() {
    if (!current) return;
    const angle = current.angle.trim();
    const result = await editor.save({ sections: current.sections, length: current.length, ...(angle ? { angle } : {}) }, current.base);
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
              {`Atual: ${brief.sections} seções · ${LENGTH_TARGETS[brief.length].label}${brief.angle ? ` · ${brief.angle}` : ''}`}
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
          <Field label="Seções" hint={`Introdução + ${current.sections} seções`}>
            {() => (
              <Segmented label="Seções depois da introdução" options={SECTIONS} value={String(current.sections)} onChange={(value) => update({ sections: Number(value) })} size="sm" />
            )}
          </Field>
          <Field label="Extensão" hint={lengthHint}>
            {() => <Segmented label="Extensão do artigo" options={LENGTHS} value={current.length} onChange={(length) => update({ length })} size="sm" />}
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
