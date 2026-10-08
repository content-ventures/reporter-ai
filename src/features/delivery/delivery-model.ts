import { assetOriginLabel, creditLine } from '../../domain/index.ts';
import type { DeliveryAttempt, DeliveryFormat, DeliveryStatus, ExportImage, PieceKind, VersionRef } from '../../domain/index.ts';
import type { DeliveryFileOutcome, DeliveryItemView, PackageFile, PackageFormat, RunView } from '../../ports/index.ts';

/**
 * Pure helpers of the Entrega screen: how the package files group on screen, what each format
 * is called, which files a delivery attempt covers and how the delivery record reads.
 */

/** Progress of one package file while the screen prepares it for download. */
export type FileProgress =
  | { state: 'pending' }
  | { state: 'building' }
  | { state: 'ready'; href: string; bytes?: number }
  | { state: 'failed'; error: { code: string; message: string } }
  | { state: 'unavailable'; reason: string };

export const FORMAT_LABELS: Record<PackageFormat, string> = {
  md: 'Markdown',
  html: 'HTML',
  png: 'PNG',
  jpg: 'JPG',
  webp: 'WebP',
  gif: 'GIF',
  pdf: 'PDF',
  json: 'JSON',
  txt: 'Texto',
  docx: 'Word',
  zip: 'ZIP',
};

const KIND_LABELS: Partial<Record<PackageFile['kind'], string>> = {
  article: 'Artigo',
  carousel: 'Carrossel',
  manifest: 'Manifesto',
  package: 'Pacote',
  image: 'Imagem',
};

export function kindLabel(kind: PackageFile['kind']): string {
  return KIND_LABELS[kind] ?? kind;
}

/** Stable key of an exact package: production + exact versions. */
export function selectionKey(productionId: string, selection: readonly VersionRef[]): string {
  return [productionId, ...selection.map((ref) => `${ref.pieceId}@${ref.versionId}:${ref.hash}`).sort()].join('|');
}

export type FileGroup = {
  id: string;
  /** "Artigo v4", "Carrossel v2", "Pacote". */
  label: string;
  item?: DeliveryItemView;
  files: PackageFile[];
};

/** One group per exported piece version (plan order), then the package-wide files. */
export function groupFiles(files: readonly PackageFile[], items: readonly DeliveryItemView[]): FileGroup[] {
  const groups: FileGroup[] = items.map((item) => ({
    id: item.version.versionId,
    label: `${item.label} v${item.version.number}`,
    item,
    files: files.filter((file) => file.versionId === item.version.versionId),
  }));
  const rest = files.filter((file) => !groups.some((group) => group.files.includes(file)));
  if (rest.length > 0) groups.push({ id: 'package', label: 'Pacote', files: rest });
  return groups.filter((group) => group.files.length > 0);
}

/** A downloadable format of the package ("Artigo · Markdown", "Slides · PNG"), for the "Baixar" menu. */
export type FormatChoice = {
  id: string;
  label: string;
  files: PackageFile[];
  available: boolean;
  reason?: string;
};

/** Article images leave as one choice ("Imagens do artigo"), whatever their formats. */
const IMAGES_CHOICE = 'image';

export function formatChoices(files: readonly PackageFile[]): FormatChoice[] {
  const choices = new Map<string, FormatChoice>();
  const images = files.filter((file) => file.kind === 'image');
  for (const file of files) {
    if (file.kind === 'image') {
      if (choices.has(IMAGES_CHOICE)) continue;
      // Linked images never leave (the browser cannot read them): only stored files count.
      const stored = images.filter((image) => image.available);
      const choice: FormatChoice = { id: IMAGES_CHOICE, label: 'Imagens do artigo', files: stored, available: stored.length > 0 };
      const reason = images.find((image) => !image.available)?.unavailableReason;
      if (!choice.available && reason) choice.reason = reason;
      choices.set(IMAGES_CHOICE, choice);
      continue;
    }
    const id = `${file.kind}:${file.format}`;
    const label = file.kind === 'carousel' && file.format === 'png' ? 'Slides · PNG' : `${kindLabel(file.kind)} · ${FORMAT_LABELS[file.format]}`;
    const choice = choices.get(id) ?? { id, label, files: [], available: file.available };
    choice.files.push(file);
    choice.available = choice.available && file.available;
    if (!file.available && file.unavailableReason) choice.reason = file.unavailableReason;
    choices.set(id, choice);
  }
  return [...choices.values()];
}

/** "Slide 1 · PNG", "Markdown", "Versões, decisões e execuções" — the row's second line. */
export function fileCaption(file: PackageFile): string {
  if (file.slideIndex !== undefined) return `Slide ${file.slideIndex + 1} · ${FORMAT_LABELS[file.format]}`;
  return FORMAT_LABELS[file.format];
}

// ── Imagens do artigo ────────────────────────────────────────────────────────────────────

/** Where the article uses the image: "Destaque", "No texto", "Destaque e no texto". */
export function imageUseLabel(image: Pick<ExportImage, 'uses'>): string {
  const cover = image.uses.some((use) => use.role === 'cover');
  const figure = image.uses.some((use) => use.role === 'figure');
  if (cover && figure) return 'Destaque e no texto';
  return cover ? 'Destaque' : 'No texto';
}

/** "Foto: Ana Prado", or "Sem crédito" (the delivery says what is missing, never hides it). */
export function imageCreditText(image: Pick<ExportImage, 'asset'>): string {
  return creditLine(image.asset?.credit) ?? 'Sem crédito';
}

/** The credit or rights changed after the version was approved (`ExportImage.approved` keeps them). */
export function changedSinceApproval(image: Pick<ExportImage, 'approved'>): boolean {
  return image.approved !== undefined;
}

/**
 * Second line of an image row: use, credit, origin and, when it applies, what is missing
 * ("Destaque · Foto: Ana Prado · Arquivo enviado · retrato.jpg").
 */
export function imageCaption(file: Pick<PackageFile, 'image' | 'format'>): string {
  const image = file.image;
  if (!image) return FORMAT_LABELS[file.format];
  const asset = image.asset;
  return [
    imageUseLabel(image),
    imageCreditText(image),
    asset && !asset.rights.authorized ? 'Uso não autorizado' : null,
    changedSinceApproval(image) ? 'Mudou depois da aprovação' : null,
    asset ? assetOriginLabel(asset.origin) : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Linked image: its address without the scheme ("exemplo.com/fotos/praca.jpg"). */
export function linkedImageAddress(file: Pick<PackageFile, 'image'>): string | undefined {
  const origin = file.image?.asset?.origin;
  return origin?.type === 'url' ? origin.url.replace(/^https?:\/\//i, '') : undefined;
}

/** What the package's images still miss before they leave (each image counted once). */
export type ImageWarnings = { unauthorized: number; uncredited: number; changed: number; missing: number };

export function imageWarnings(files: readonly Pick<PackageFile, 'image'>[]): ImageWarnings {
  const warnings: ImageWarnings = { unauthorized: 0, uncredited: 0, changed: 0, missing: 0 };
  const seen = new Set<string>();
  for (const { image } of files) {
    if (!image || seen.has(image.assetId)) continue;
    seen.add(image.assetId);
    if (!image.asset) {
      warnings.missing += 1;
      continue;
    }
    if (!image.asset.rights.authorized) warnings.unauthorized += 1;
    if (!image.asset.credit?.trim()) warnings.uncredited += 1;
    if (changedSinceApproval(image)) warnings.changed += 1;
  }
  return warnings;
}

/** "2 imagens sem uso autorizado · 1 sem crédito"; undefined when nothing is missing. */
export function imageWarningLine(warnings: ImageWarnings): string | undefined {
  const parts = [
    warnings.unauthorized > 0 ? `${warnings.unauthorized} sem uso autorizado` : null,
    warnings.uncredited > 0 ? `${warnings.uncredited} sem crédito` : null,
    warnings.changed > 0 ? `${warnings.changed} alterada${warnings.changed === 1 ? '' : 's'} depois da aprovação` : null,
    warnings.missing > 0 ? `${warnings.missing} fora deste navegador` : null,
  ].filter((part): part is string => part !== null);
  const [first, ...rest] = parts;
  if (!first) return undefined;
  // "1 imagem sem crédito", "2 imagens sem uso autorizado · 1 sem crédito".
  const lead = first.replace(/^(\d+) /, (_, count: string) => `${count} ${count === '1' ? 'imagem' : 'imagens'} `);
  return [lead, ...rest].join(' · ');
}

/** Rastreabilidade: "5 imagens · 1 link externo" (each image's credit and origin are in the package rows). */
export function imageSummary(files: readonly Pick<PackageFile, 'image'>[]): string | undefined {
  const images = new Map<string, NonNullable<PackageFile['image']>>();
  for (const { image } of files) if (image) images.set(image.assetId, image);
  if (images.size === 0) return undefined;
  const links = [...images.values()].filter((image) => image.asset?.origin.type === 'url').length;
  return [`${images.size} ${images.size === 1 ? 'imagem' : 'imagens'}`, links > 0 ? `${links} ${links === 1 ? 'link externo' : 'links externos'}` : null].filter(Boolean).join(' · ');
}

/** Files that leave in a delivery attempt (zip and disabled formats never do). */
export function deliverableFiles(files: readonly PackageFile[]): (PackageFile & { format: DeliveryFormat })[] {
  return files.filter((file): file is PackageFile & { format: DeliveryFormat } => file.available && file.format !== 'zip');
}

/** Outcome of each deliverable file, shaped for `recordDelivery({ files })`. */
export function fileOutcomes(files: readonly PackageFile[], progress: Readonly<Record<string, FileProgress>>): DeliveryFileOutcome[] {
  return deliverableFiles(files).map((file) => {
    const state = progress[file.fileName];
    const outcome: DeliveryFileOutcome = { fileName: file.fileName, format: file.format, ok: state?.state === 'ready' };
    if (file.versionId) outcome.versionId = file.versionId;
    if (state?.state === 'failed') outcome.error = state.error;
    else if (state?.state !== 'ready') outcome.error = { code: 'not_ready', message: 'Arquivo ainda não gerado.' };
    return outcome;
  });
}

/**
 * What actually left: a file that was ready but whose link could not be clicked (no anchor on
 * screen) is not delivered, so the record and the toast never claim it.
 */
export function downloadedOutcomes(outcomes: readonly DeliveryFileOutcome[], saved: readonly string[]): DeliveryFileOutcome[] {
  const left = new Set(saved);
  return outcomes.map((outcome) =>
    outcome.ok && !left.has(outcome.fileName) ? { ...outcome, ok: false, error: { code: 'not_downloaded', message: 'O arquivo não foi baixado. Tente de novo.' } } : outcome,
  );
}

/** Files that failed in a delivery attempt and never succeeded afterwards. */
export function pendingFailures(attempts: readonly DeliveryAttempt[]): Set<string> {
  const failed = new Set<string>();
  for (const attempt of attempts) {
    for (const name of attempt.items ?? []) {
      if (attempt.status === 'failed') failed.add(name);
      else failed.delete(name);
    }
  }
  return failed;
}

export const DELIVERY_STATUS: Record<DeliveryStatus | 'none', { label: string; tone: 'gray' | 'orange' | 'red' | 'violet'; hollow?: boolean }> = {
  none: { label: 'Não exportada', tone: 'gray', hollow: true },
  pending: { label: 'Na fila', tone: 'gray', hollow: true },
  in_progress: { label: 'Exportando', tone: 'gray' },
  scheduled: { label: 'Agendada', tone: 'violet' },
  completed: { label: 'Concluída', tone: 'gray' },
  partial: { label: 'Parcial', tone: 'orange' },
  failed: { label: 'Falhou', tone: 'red' },
};

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** Stage spans: "12 min", "5 h 20 min", "3 dias 4 h" (`formatDuration` below one hour). */
export function formatSpan(ms: number, short: (ms: number) => string): string {
  if (ms < HOUR_MS) return short(ms);
  if (ms < 2 * DAY_MS) {
    const hours = Math.floor(ms / HOUR_MS);
    const minutes = Math.round((ms % HOUR_MS) / 60_000);
    return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
  }
  const days = Math.floor(ms / DAY_MS);
  const hours = Math.round((ms % DAY_MS) / HOUR_MS);
  return hours > 0 ? `${days} dias ${hours} h` : `${days} dias`;
}

/** Stage timings of the pilot (REQ-T.8), in journey order. */
export const STAGE_DURATION_LABELS: readonly { id: string; label: string }[] = [
  { id: 'article', label: 'Artigo' },
  { id: 'carousel', label: 'Carrossel' },
  { id: 'delivery', label: 'Entrega' },
  { id: 'total', label: 'Total' },
];

/** The piece the person must act on before Entrega opens (first planned piece without approval). */
export function blockingPiece<P extends { kind: PieceKind; approvedVersion?: unknown }>(pieces: readonly P[], plan: readonly PieceKind[]): P | undefined {
  for (const kind of plan) {
    const piece = pieces.find((candidate) => candidate.kind === kind);
    if (piece && !piece.approvedVersion) return piece;
  }
  return undefined;
}

const GENERATION_KINDS = new Set<string>(['article.generate', 'carousel.generate']);

/**
 * The AI run behind each exported piece: the run that produced the exact version, or else the
 * latest completed generation of that piece (an edited v2 still comes from the v1 · IA run).
 */
export function traceRuns(
  items: readonly Pick<DeliveryItemView, 'version'>[],
  exact: readonly RunView[],
  all: readonly RunView[],
): RunView[] {
  const runs: RunView[] = [];
  for (const item of items) {
    const pieceId = item.version.pieceId;
    const own = exact.find((run) => run.output?.pieceId === pieceId);
    const latest = all
      .filter((run) => !run.parentRunId && run.status === 'completed' && GENERATION_KINDS.has(run.kind) && (run.output?.pieceId ?? run.pieceId) === pieceId)
      .sort((a, b) => (b.endedAt ?? b.createdAt).localeCompare(a.endedAt ?? a.createdAt))[0];
    const run = own ?? latest;
    if (run && !runs.some((entry) => entry.id === run.id)) runs.push(run);
  }
  return runs;
}
