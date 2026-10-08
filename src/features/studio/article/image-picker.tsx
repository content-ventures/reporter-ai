'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  ConfirmDialog,
  Drawer,
  Field,
  Input,
  LinkButton,
  MediaFrame,
  MetaList,
  PageStack,
  SwitchRow,
  Tabs,
  Textarea,
  focusField,
  formatBytes,
  toast,
} from '@content-ventures/design-system/v3';
import { assetOriginLabel, type AssetId, type BlockId, type ImageAsset, type ImageRef, type ProductionId } from '@/domain';
import type { FigurePlacement } from '@/editor';
import type { UnusedAssets } from '@/ports';
import { imageSource, imageSourcesFor, type ImageSourceId } from '@/registries';
import { useAssetLookup, useAssetUrl, useCommands } from '@/state';
import { formatCount, plural } from '@/ui/format';
import { ICONS } from '@/ui/icons';
import {
  creditHint,
  fieldsOf,
  imageRefOf,
  pickerCopy,
  rightsChanged,
  withSuggested,
  type ImageFields,
  type ImageRole,
  type PickerMode,
} from './image-model';
import { IMAGE_SOURCE_PANELS, type SourceRefusal } from './image-sources';

/**
 * Image picker (DS `Drawer`): "Inserir imagem", "Imagem de destaque" and "Legenda e crédito".
 * The tabs are the image sources of the current release that have a panel (`image-sources`):
 * R1 "Enviar arquivo" (Dropzone: JPG, PNG, WebP or GIF up to 10 MB) and "Link" (an http/https
 * address that must open an image); R2 "Acervo" and R6 "Gerar com IA" plug in as panels, the
 * picker stays as it is. Alt text, caption, credit ("Foto: …") and "Uso autorizado" travel with
 * the image; credit and rights belong to the asset (every use shows them), alt and caption to this
 * use. Esc, the X and "Cancelar" ask before discarding what was typed. Every refusal shows where it
 * happened: on the file, on the address, or as an Alert when the browser storage fails — a full
 * storage offers to delete the images no text uses any more.
 */

export type PickerRequest = {
  /** New on every open: the form starts over. */
  key: number;
  role: ImageRole;
  mode: PickerMode;
  /** The use being replaced or edited: alt and caption (credit and rights too when editing). */
  current?: ImageRef;
  /** Figure being replaced or edited; a new figure goes to `placement`. */
  blockId?: BlockId;
  placement?: FigurePlacement;
  /** An image file that arrived by paste or drop. */
  file?: File;
  /** "Legenda e crédito" opened from the caption: the caption takes the focus. */
  focus?: 'caption';
};

export type PickedImage = { asset: ImageAsset; image: ImageRef };

const EMPTY_FIELDS: ImageFields = { alt: '', caption: '', credit: '', authorized: false };

/** Credit a source marked as AI starts with (README §6: AI images are labelled as such). */
const AI_CREDIT = 'Gerada com IA';

type Drafts = Partial<Record<ImageSourceId, unknown>>;

type Form = {
  mode: PickerMode;
  tab: ImageSourceId;
  /** Each source's own state (kept while the person switches tabs). */
  drafts: Drafts;
  fields: ImageFields;
  initial: ImageFields;
  failure?: { message: string; quota: boolean };
};

/** Sources of this release that have a panel, in registry order. */
function pickerSources() {
  return imageSourcesFor().filter((source) => IMAGE_SOURCE_PANELS[source.id] !== undefined);
}

function initialDrafts(file?: File): Drafts {
  const drafts: Drafts = {};
  for (const source of pickerSources()) {
    const panel = IMAGE_SOURCE_PANELS[source.id];
    if (panel) drafts[source.id] = panel.initial(panel.takesFiles ? file : undefined);
  }
  return drafts;
}

function formFor(request: PickerRequest, asset: ImageAsset | undefined): Form {
  const editing = request.mode === 'edit';
  const fields = fieldsOf(request.current, editing ? asset : undefined);
  const sources = pickerSources();
  // A pasted or dropped file opens the tab that takes files.
  const tab = (request.file ? sources.find((source) => IMAGE_SOURCE_PANELS[source.id]?.takesFiles) : undefined) ?? sources[0];
  return { mode: request.mode, tab: tab?.id ?? 'upload', drafts: initialDrafts(request.file), fields, initial: fields };
}

export type ImagePickerProps = {
  request: PickerRequest | null;
  productionId: ProductionId;
  onClose: () => void;
  /** The image is stored (and its credit and rights saved): put it in the text. */
  onDone: (request: PickerRequest, picked: PickedImage) => void;
  /** Images the screen holds but has not saved yet (the text on screen, what undo can bring back). */
  inUse?: () => Iterable<AssetId>;
};

export function ImagePicker({ request, productionId, onClose, onDone, inUse }: ImagePickerProps) {
  const commands = useCommands();
  const lookup = useAssetLookup();
  const sources = useMemo(() => pickerSources(), []);
  const [session, setSession] = useState<number | null>(null);
  const [form, setForm] = useState<Form>({ mode: 'choose', tab: sources[0]?.id ?? 'upload', drafts: {}, fields: EMPTY_FIELDS, initial: EMPTY_FIELDS });
  const [saving, setSaving] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [freeable, setFreeable] = useState<UnusedAssets | null>(null);
  const [freeing, setFreeing] = useState(false);
  const [shown, setShown] = useState<PickerRequest | null>(request);
  if ((request?.key ?? null) !== session) {
    setSession(request?.key ?? null);
    if (request) {
      setShown(request);
      setForm(formFor(request, request.current ? lookup(request.current.assetId) : undefined));
      setSaving(false);
      setDiscarding(false);
      setFreeable(null);
    }
  }
  // While the drawer slides out, it keeps showing what it was about.
  const active = request ?? shown;
  const open = request !== null;

  const id = useId();
  const altId = `${id}-alt`;
  const captionId = `${id}-caption`;
  const currentAsset = active?.current ? lookup(active.current.assetId) : undefined;
  const replacing = Boolean(active?.current);
  const copy = pickerCopy(active?.role ?? 'figure', form.mode, replacing);
  const fit = active?.role === 'cover' ? 'cover' : 'contain';
  const panel = IMAGE_SOURCE_PANELS[form.tab];
  const SourcePanel = panel?.Panel;
  const draft = form.drafts[form.tab];

  // Choosing: the source's own control takes the focus once the drawer is open (the Dropzone, so
  // the phone keyboard stays down); otherwise the drawer's first field (the address on "Link").
  const focusTarget = form.mode === 'choose' && panel && draft !== undefined ? panel.focusOnOpen(id, draft) : undefined;
  const focusOnOpen = useRef(focusTarget);
  useEffect(() => {
    focusOnOpen.current = focusTarget;
  });
  useEffect(() => {
    if (!open) return undefined;
    let frame = window.requestAnimationFrame(() => {
      frame = window.requestAnimationFrame(() => {
        if (focusOnOpen.current) focusField(focusOnOpen.current);
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, session]);

  const setDraft = (tab: ImageSourceId, next: unknown) => setForm((current) => ({ ...current, drafts: { ...current.drafts, [tab]: next }, failure: undefined }));
  const setField = <K extends keyof ImageFields>(name: K, value: ImageFields[K]) =>
    setForm((current) => ({ ...current, fields: { ...current.fields, [name]: value }, failure: undefined }));
  const suggest = (fields: Partial<ImageFields>) => setForm((current) => ({ ...current, fields: withSuggested(current.fields, fields) }));
  const fieldsDirty = (Object.keys(form.fields) as (keyof ImageFields)[]).some((name) => form.fields[name] !== form.initial[name]);
  const chosen =
    form.mode === 'choose' &&
    sources.some((source) => {
      const value = form.drafts[source.id];
      return value !== undefined && (IMAGE_SOURCE_PANELS[source.id]?.dirty(value) ?? false);
    });
  const dirty = fieldsDirty || chosen;

  const changeTab = (tab: ImageSourceId) => {
    setForm((current) => {
      // A source marked as AI starts with its credit line (editable).
      const fields = imageSource(tab)?.ai && !current.fields.credit.trim() ? { ...current.fields, credit: AI_CREDIT } : current.fields;
      return { ...current, tab, fields, failure: undefined };
    });
  };

  async function submit(): Promise<void> {
    if (!active || saving) return;
    const image = (assetId: string) => imageRefOf(assetId, form.fields);

    if (form.mode === 'edit') {
      const asset = currentAsset;
      if (!asset || !active.current) {
        setForm((current) => ({ ...current, failure: { message: 'Imagem não encontrada neste navegador. Troque a imagem.', quota: false } }));
        return;
      }
      let saved = asset;
      if (rightsChanged(asset, form.fields)) {
        setSaving(true);
        const result = await commands.assets.update(asset.id, { credit: form.fields.credit, rights: { ...asset.rights, authorized: form.fields.authorized } });
        setSaving(false);
        if (!result.ok) {
          setForm((current) => ({ ...current, failure: { message: result.refusal.message, quota: result.refusal.code === 'quota' } }));
          return;
        }
        saved = result.value;
      }
      onDone(active, { asset: saved, image: image(saved.id) });
      return;
    }

    const tab = form.tab;
    if (!panel || draft === undefined) return;
    setSaving(true);
    const checked = await panel.submit(draft, id);
    if (!checked.ok) {
      setSaving(false);
      setDraft(tab, checked.state);
      focusField(checked.focus);
      return;
    }
    const fields = withSuggested(form.fields, checked.selection.suggested);
    const meta = { productionId, authorized: fields.authorized, ...(fields.credit.trim() ? { credit: fields.credit } : {}) };
    const result = await commands.assets.put(checked.selection.input, meta);
    if (!result.ok) {
      setSaving(false);
      const refusal: SourceRefusal = result.refusal;
      const shownInPanel = panel.refused(draft, refusal, id);
      if (shownInPanel) {
        setDraft(tab, shownInPanel.state);
        focusField(shownInPanel.focus);
        return;
      }
      const quota = refusal.code === 'quota';
      setForm((current) => ({ ...current, failure: { message: refusal.message, quota } }));
      setFreeable(quota ? await commands.assets.unused(inUse?.() ?? []) : null);
      return;
    }
    setSaving(false);
    onDone(active, { asset: result.value, image: imageRefOf(result.value.id, fields) });
  }

  /** "Liberar espaço": deletes the images no text uses any more, then stores this one. */
  async function freeSpace(): Promise<void> {
    setFreeing(true);
    const freed = await commands.assets.freeSpace(inUse?.() ?? []);
    setFreeing(false);
    setFreeable(null);
    if (!freed.ok) {
      setForm((current) => ({ ...current, failure: { message: freed.refusal.message, quota: false } }));
      return;
    }
    toast(plural(freed.value.count, 'imagem fora de uso apagada', 'imagens fora de uso apagadas'), { description: `${formatBytes(freed.value.bytes)} livres neste navegador.` });
    setForm((current) => ({ ...current, failure: undefined }));
    await submit();
  }

  const cancel = () => (dirty ? setDiscarding(true) : onClose());
  // Esc and the X ask like "Cancelar"; nothing closes while the image is being stored.
  const dismiss = () => {
    if (!saving && !freeing) cancel();
  };

  return (
    <>
      <Drawer
        open={open}
        onClose={dismiss}
        title={copy.title}
        description={form.mode === 'edit' && currentAsset ? assetOriginLabel(currentAsset.origin) : undefined}
        dismissible={!dirty && !saving}
        footer={
          <>
            <Button onClick={dismiss}>Cancelar</Button>
            <Button variant="primary" loading={saving || freeing} onClick={() => void submit()}>
              {copy.primary}
            </Button>
          </>
        }
      >
        <PageStack>
          {form.mode === 'edit' ? (
            <CurrentImage
              assetId={active?.current?.assetId}
              asset={currentAsset}
              alt={form.fields.alt}
              fit={fit}
              onReplace={() =>
                setForm((current) => ({
                  ...current,
                  mode: 'choose',
                  fields: { ...current.fields, credit: '', authorized: false },
                  initial: { ...current.initial, credit: '', authorized: false },
                }))
              }
            />
          ) : (
            <>
              {sources.length > 1 ? (
                <Tabs
                  label="Origem da imagem"
                  size="sm"
                  items={sources.map((source) => ({ value: source.id, label: source.label, icon: ICONS[source.icon] }))}
                  value={form.tab}
                  onChange={changeTab}
                />
              ) : null}
              {SourcePanel && draft !== undefined ? (
                <SourcePanel id={id} state={draft} onChange={(next) => setDraft(form.tab, next)} fit={fit} alt={form.fields.alt} onSuggest={suggest} />
              ) : null}
            </>
          )}
          <Field label="Texto alternativo" optional hint="Descreva a imagem para quem usa leitor de tela." id={altId}>
            {({ id: fieldId, describedBy }) => (
              <Input
                id={fieldId}
                aria-describedby={describedBy}
                data-autofocus={form.mode === 'edit' && active?.focus !== 'caption' ? '' : undefined}
                value={form.fields.alt}
                maxLength={200}
                autoComplete="off"
                onChange={(event) => setField('alt', event.target.value)}
              />
            )}
          </Field>
          <Field label="Legenda" optional id={captionId}>
            {({ id: fieldId, describedBy }) => (
              <Textarea
                id={fieldId}
                aria-describedby={describedBy}
                data-autofocus={form.mode === 'edit' && active?.focus === 'caption' ? '' : undefined}
                value={form.fields.caption}
                maxLength={280}
                rows={2}
                autoSize={{ minRows: 2, maxRows: 5 }}
                onChange={(event) => setField('caption', event.target.value)}
              />
            )}
          </Field>
          <Field label="Crédito" hint={creditHint(form.fields.credit)}>
            {({ id: fieldId, describedBy }) => (
              <Input
                id={fieldId}
                aria-describedby={describedBy}
                value={form.fields.credit}
                maxLength={120}
                autoComplete="off"
                onChange={(event) => setField('credit', event.target.value)}
              />
            )}
          </Field>
          <SwitchRow
            label="Uso autorizado"
            description="Sem autorização, a checagem avisa."
            checked={form.fields.authorized}
            onCheckedChange={(authorized) => setField('authorized', authorized)}
          />
          {form.failure ? (
            <Alert
              tone="danger"
              title="Não foi possível guardar a imagem"
              action={
                form.failure.quota && freeable && freeable.bytes > 0 ? (
                  <LinkButton onClick={() => void freeSpace()}>{`Liberar ${formatBytes(freeable.bytes)}`}</LinkButton>
                ) : undefined
              }
            >
              {form.failure.quota && freeable && freeable.bytes > 0
                ? `${form.failure.message} ${plural(freeable.count, 'imagem não está', 'imagens não estão')} em nenhum texto.`
                : form.failure.message}
            </Alert>
          ) : null}
        </PageStack>
      </Drawer>
      <ConfirmDialog
        open={discarding}
        onClose={() => setDiscarding(false)}
        title="Descartar a imagem?"
        description={form.mode === 'edit' ? 'A legenda e o crédito voltam ao que eram.' : 'A imagem escolhida e o que foi digitado se perdem.'}
        confirmLabel="Descartar"
        tone="danger"
        onConfirm={() => {
          setDiscarding(false);
          onClose();
        }}
      />
    </>
  );
}

/** "Legenda e crédito": the image as it is, with its size and "Trocar imagem". */
function CurrentImage({
  assetId,
  asset,
  alt,
  fit,
  onReplace,
}: {
  assetId: string | undefined;
  asset: ImageAsset | undefined;
  alt: string;
  fit: 'cover' | 'contain';
  onReplace: () => void;
}) {
  const url = useAssetUrl(assetId);
  const size = asset?.width && asset.height ? `${formatCount(asset.width)} × ${formatCount(asset.height)} px` : null;
  return (
    <MediaFrame
      ratio="16/9"
      fit={fit}
      src={url.data}
      state={url.status === 'loading' ? 'loading' : undefined}
      alt={alt || 'Imagem atual'}
      caption={
        <MetaList
          size="sm"
          items={[
            size ? { value: size, numeric: true } : null,
            asset?.bytes ? { value: formatBytes(asset.bytes), numeric: true } : null,
            <LinkButton key="replace" size="sm" onClick={onReplace}>
              Trocar imagem
            </LinkButton>,
          ]}
        />
      }
    />
  );
}
