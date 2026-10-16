'use client';

import { useEffect, useRef, useState, type ComponentType } from 'react';
import { Button, Dropzone, Field, Input, LinkButton, MediaFrame, MetaList, PageStack, Textarea, focusField, formatBytes } from '@content-ventures/design-system/v3';
import { AI_IMAGE_CREDIT, IMAGE_LIMITS, IMAGE_PROMPT_MAX, validateImageFile, validateImageUrl, type ProductionId } from '@/domain';
import { Sparkles } from '@content-ventures/design-system/v3/icons';
import { useRuntime } from '@/state';
import type { AssetInput, AssetRefusal } from '@/ports';
import type { ImageSourceId } from '@/registries';
import { probeImage, useImageProbe } from '@/ui/image-probe';
import { refusedFileMessage, type ImageFields } from './image-model';
import { LibraryBrowser } from '@/features/images/library-browser';
import { libraryImageSource, libraryImageNote, publicationImageCredit, type LibraryImage } from '@/domain/visual-library';

/**
 * The tabs of the image picker, one panel per image source of the registry
 * (`imageSourcesFor()`): R1 "Enviar arquivo", "Link" and the connected "Biblioteca" (only while a photo
 * bank works, see `usePhotoBanks`). A source plugs in by adding its panel
 * here — future semantic archive/AI sources remain separate — and the
 * picker stays as it is: each panel keeps its own state (kept while the person switches tabs),
 * says whether something was chosen, shows its own errors, and hands the store an `AssetInput`
 * of its origin plus what it already knows of the image (an archive record's caption and credit).
 */

/** What a source hands the picker: the store input, and the fields it can fill. */
export type SourceSelection = {
  input: AssetInput;
  /** Caption, credit, alt or rights the source already knows (empty fields take them). */
  suggested?: Partial<ImageFields>;
  meta?: Pick<import('@/ports').AssetMeta, 'note' | 'provenance' | 'credit'>;
};

export type SourceSubmit<S> = { ok: true; selection: SourceSelection } | { ok: false; state: S; focus: string };

export type SourceRefusal = { code: AssetRefusal; message: string };

export type SourcePanelProps<S> = {
  /** Prefix of the panel's field ids (focus targets and error links). */
  id: string;
  state: S;
  onChange: (next: S) => void;
  /** The cover previews as it shows (filled 16:9); a figure whole. */
  fit: 'cover' | 'contain';
  /** Alt text typed so far, for the preview. */
  alt: string;
  /** Fills the fields still empty with what the source knows (an archive record's credit). */
  onSuggest: (fields: Partial<ImageFields>, creditOptional?: boolean) => void;
  /** The production the image is for. */
  productionId: ProductionId;
};

export type ImageSourcePanel<S> = {
  /**
   * Start state; `file` is an image that arrived by paste or drop (sources that take files),
   * `prompt` what the image should show (a suggestion's, or the description an AI image came from).
   */
  initial(start: { file?: File; prompt?: string }): S;
  /** Takes a pasted or dropped file (the picker opens on this tab). */
  takesFiles?: true;
  /** Something chosen or typed: "Cancelar" asks before discarding it. */
  dirty(state: S): boolean;
  /** Control that takes the focus when the picker opens on this tab, if not the first field. */
  focusOnOpen(id: string, state: S): string | undefined;
  /** Ready to store, or the state with the reason shown and the control to focus. */
  submit(state: S, id: string): Promise<SourceSubmit<S>>;
  /** A store refusal about this input, shown in the panel (`null`: not about the input, e.g. quota). */
  refused(state: S, refusal: SourceRefusal, id: string): { state: S; focus: string } | null;
  Panel: ComponentType<SourcePanelProps<S>>;
};

/** Panels are stored type-erased: each keeps its own state shape behind the registry. */
type AnyPanel = ImageSourcePanel<unknown>;

function panel<S>(definition: ImageSourcePanel<S>): AnyPanel {
  return definition as unknown as AnyPanel;
}

// ——— "Enviar arquivo" ———

type UploadState = { file: File | null; error?: string };

const FILE_REFUSALS: ReadonlySet<AssetRefusal> = new Set<AssetRefusal>(['empty', 'too_large', 'unsupported_type', 'unreadable']);

const dropzoneId = (id: string) => `${id}-file`;
/** The Dropzone's own focusable target (`${id}-dropzone`). */
const dropzoneTarget = (id: string) => `${dropzoneId(id)}-dropzone`;

function checkFile(file: File): UploadState {
  const check = validateImageFile({ name: file.name, type: file.type, size: file.size });
  return check.ok ? { file } : { file: null, error: check.refusal.message };
}

/** Local preview of a chosen file, revoked when the file changes or the picker closes. */
function useFilePreview(file: Blob | null): string | undefined {
  const [preview, setPreview] = useState<{ file: Blob; url: string } | null>(null);
  useEffect(() => {
    if (!file) return undefined;
    const url = URL.createObjectURL(file);
    let live = true;
    queueMicrotask(() => {
      if (live) setPreview({ file, url });
    });
    return () => {
      live = false;
      URL.revokeObjectURL(url);
    };
  }, [file]);
  return preview?.file === file ? preview.url : undefined;
}

function UploadPanel({ id, state, onChange, fit, alt }: SourcePanelProps<UploadState>) {
  const preview = useFilePreview(state.file);
  if (state.file) {
    return (
      <MediaFrame
        ratio="16/9"
        fit={fit}
        src={preview}
        state={preview ? undefined : 'loading'}
        alt={alt || 'Prévia da imagem'}
        caption={
          <MetaList
            size="sm"
            wrap={false}
            items={[
              state.file.name,
              { value: formatBytes(state.file.size), numeric: true },
              <LinkButton key="other" size="sm" onClick={() => onChange({ file: null })}>
                Trocar imagem
              </LinkButton>,
            ]}
          />
        }
      />
    );
  }
  return (
    <Dropzone
      id={dropzoneId(id)}
      accept={IMAGE_LIMITS.accept}
      maxSize={IMAGE_LIMITS.maxBytes}
      title="Arraste a imagem aqui ou escolha um arquivo"
      spec={IMAGE_LIMITS.hint}
      invalid={Boolean(state.error)}
      error={state.error}
      onFiles={(files, rejected) => {
        const [file] = files;
        if (file) onChange(checkFile(file));
        else if (rejected[0]) onChange({ file: null, error: refusedFileMessage(rejected[0].file) });
      }}
    />
  );
}

const uploadPanel = panel<UploadState>({
  takesFiles: true,
  initial: ({ file }) => (file ? checkFile(file) : { file: null }),
  dirty: (state) => state.file !== null,
  focusOnOpen: (id, state) => (state.file ? undefined : dropzoneTarget(id)),
  async submit(state, id) {
    if (!state.file) return { ok: false, state: { file: null, error: state.error ?? 'Escolha uma imagem.' }, focus: dropzoneTarget(id) };
    return { ok: true, selection: { input: { type: 'upload', file: state.file, fileName: state.file.name } } };
  },
  refused: (_state, refusal, id) => (FILE_REFUSALS.has(refusal.code) ? { state: { file: null, error: refusal.message }, focus: dropzoneTarget(id) } : null),
  Panel: UploadPanel,
});

// ——— "Link" ———

type LinkState = { link: string; error?: string; preview?: string };

const NOT_AN_IMAGE = 'O endereço não abre uma imagem. Confira o link ou envie o arquivo.';

const linkId = (id: string) => `${id}-link`;

function LinkPanel({ id, state, onChange, fit, alt }: SourcePanelProps<LinkState>) {
  const probe = useImageProbe(state.preview);
  const show = () => {
    const url = validateImageUrl(state.link);
    if (url.ok) onChange({ link: state.link, preview: url.value });
    else onChange({ link: state.link, ...(state.link.trim() ? { error: url.refusal.message } : {}) });
  };
  const error = state.error ?? (probe?.status === 'error' ? NOT_AN_IMAGE : undefined);
  return (
    <>
      <Field label="Endereço da imagem" error={error} hint="No pacote de entrega, entra como link." id={linkId(id)}>
        {({ id: fieldId, describedBy, invalid }) => (
          <Input
            id={fieldId}
            aria-describedby={describedBy}
            invalid={invalid}
            value={state.link}
            inputMode="url"
            placeholder="https://"
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => onChange({ link: event.target.value, ...(state.preview ? { preview: state.preview } : {}) })}
            onBlur={show}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                show();
              }
            }}
          />
        )}
      </Field>
      {state.preview && probe?.status !== 'error' ? <MediaFrame key={state.preview} ratio="16/9" fit={fit} src={state.preview} alt={alt || 'Prévia da imagem'} /> : null}
    </>
  );
}

const linkPanel = panel<LinkState>({
  initial: () => ({ link: '' }),
  dirty: (state) => state.link.trim() !== '',
  focusOnOpen: () => undefined,
  async submit(state, id) {
    const url = validateImageUrl(state.link);
    if (!url.ok) return { ok: false, state: { link: state.link, error: url.refusal.message }, focus: linkId(id) };
    // The address must open an image (a page or a broken link would be an empty figure); its
    // size is kept, so the text reserves the image's box.
    const probe = await probeImage(url.value);
    if (probe.status !== 'loaded') return { ok: false, state: { link: state.link, preview: url.value, error: NOT_AN_IMAGE }, focus: linkId(id) };
    return { ok: true, selection: { input: { type: 'url', url: url.value, width: probe.width, height: probe.height } } };
  },
  refused: (state, refusal, id) =>
    refusal.code === 'invalid_url' || refusal.code === 'empty' ? { state: { link: state.link, error: refusal.message }, focus: linkId(id) } : null,
  Panel: LinkPanel,
});

// ——— "Gerar com IA" ———

type GenerateState = { prompt: string; image?: { file: Blob; prompt: string }; error?: string };

const promptId = (id: string) => `${id}-prompt`;
const generateId = (id: string) => `${id}-generate`;

/**
 * What the image should show (a suggestion's description to start from), "Gerar" and, once there
 * is an image, "Gerar de novo" (the description can change in between). The simulation answers
 * with the example's images.
 */
function GeneratePanel({ id, state, onChange, fit, alt, productionId }: SourcePanelProps<GenerateState>) {
  const { runtime } = useRuntime();
  const generator = runtime?.imageGeneration;
  const [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const preview = useFilePreview(state.image?.file ?? null);
  async function generate() {
    if (!generator || busy) return;
    if (!state.prompt.trim()) {
      onChange({ ...state, error: 'Descreva a imagem.' });
      focusField(promptId(id));
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    const result = await generator.generate({ productionId, prompt: state.prompt }, controller.signal);
    if (controller.signal.aborted) return;
    setBusy(false);
    onChange(result.ok ? { prompt: state.prompt, image: { file: result.value.file, prompt: state.prompt.trim() } } : { ...state, error: result.refusal.message });
  }
  return (
    <>
      <Field label="Descrição da imagem" error={state.error} id={promptId(id)}>
        {({ id: fieldId, describedBy, invalid }) => (
          <Textarea
            id={fieldId}
            aria-describedby={describedBy}
            invalid={invalid}
            value={state.prompt}
            maxLength={IMAGE_PROMPT_MAX}
            rows={2}
            autoSize={{ minRows: 2, maxRows: 6 }}
            readOnly={busy}
            onChange={(event) => onChange({ ...state, prompt: event.target.value, error: undefined })}
          />
        )}
      </Field>
      <Button id={generateId(id)} icon={Sparkles} loading={busy} onClick={() => void generate()}>
        {state.image ? 'Gerar de novo' : 'Gerar'}
      </Button>
      {busy || state.image ? (
        <MediaFrame ratio="16/9" fit={fit} src={busy ? undefined : preview} state={busy || !preview ? 'loading' : undefined} alt={alt || 'Imagem gerada'} />
      ) : null}
    </>
  );
}

const generatePanel = panel<GenerateState>({
  initial: ({ prompt }) => ({ prompt: prompt ?? '' }),
  dirty: (state) => Boolean(state.image),
  focusOnOpen: (id, state) => (state.prompt.trim() ? generateId(id) : undefined),
  async submit(state, id) {
    if (!state.image) return { ok: false, state: { ...state, error: 'Gere a imagem antes de usar.' }, focus: generateId(id) };
    return {
      ok: true,
      selection: { input: { type: 'generated', file: state.image.file, prompt: state.image.prompt }, suggested: { credit: AI_IMAGE_CREDIT, authorized: true } },
    };
  },
  refused: (state, refusal, id) => (FILE_REFUSALS.has(refusal.code) ? { state: { ...state, image: undefined, error: refusal.message }, focus: generateId(id) } : null),
  Panel: GeneratePanel,
});

/**
 * Panels by source. A source without a panel here is not offered, even when its release is out:
 * R6 adds `semantic-search`.
 */
export const IMAGE_SOURCE_PANELS: Readonly<Partial<Record<ImageSourceId, AnyPanel>>> = {
  upload: uploadPanel,
  link: linkPanel,
  generate: generatePanel,
  archive: panel<{ selected?: LibraryImage; error?: string }>({
    initial: () => ({}),dirty: state => Boolean(state.selected),focusOnOpen: () => undefined,
    async submit(state,id) {
      if (!state.selected) return { ok: false,state: { error: 'Selecione uma imagem da biblioteca.' },focus: id };
      const image = state.selected;
      return { ok: true,selection: {
        input: { type: 'url',url: new URL(libraryImageSource(image),window.location.origin).href,width: image.width,height: image.height },
        suggested: { credit: publicationImageCredit(image) },
        meta: { ...(image.provider === 'pixabay' ? {} : { credit: image.attribution }),note: libraryImageNote(image),provenance: { ...image,libraryId: image.id } },
      } };
    },
    refused: (state,refusal,id) => ({ state: { ...state,error: refusal.message },focus: id }),
    Panel: ({ state,onChange,onSuggest }) => <PageStack>
      <LibraryBrowser selectedId={state.selected?.id} onSelect={image => { onChange({ selected: image });onSuggest({ credit: publicationImageCredit(image),alt: image.title,caption: `Imagem ilustrativa: ${image.title}` }); }} />
      {state.error ? <MetaList items={[state.error]} /> : null}
    </PageStack>,
  }),
};
