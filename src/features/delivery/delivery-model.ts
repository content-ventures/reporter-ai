import { assetOriginLabel, creditLine } from '../../domain/index.ts';
import type { Delivery, DeliveryAttempt, DeliveryFormat, DeliveryStatus, ExportImage, PieceKind, VersionRef } from '../../domain/index.ts';
import { formatLaudas } from '../../domain/sizing.ts';
import type { DeliveryFileOutcome, DeliveryItemView, PackageFile, PackageFormat, RunView } from '../../ports/index.ts';
import { firstName, formatDayMonth, formatDayTime } from '../../ui/approval-copy.ts';

/**
 * Pure helpers of the Entrega screen (D12, COPY §8): the sentences of its notices and cards, how
 * the package files group under "Arquivos do pacote", the "Baixar só" formats, which files a
 * delivery attempt covers and how the delivery record reads (admin "Detalhes técnicos").
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
  json: 'Dados',
  txt: 'Texto',
  docx: 'Word',
  zip: 'ZIP',
};

/** Stable key of an exact package: production + exact versions. */
export function selectionKey(productionId: string, selection: readonly VersionRef[]): string {
  return [productionId, ...selection.map((ref) => `${ref.pieceId}@${ref.versionId}:${ref.hash}`).sort()].join('|');
}

export type FileGroup = {
  id: 'article' | 'carousel' | 'record';
  /** "Artigo", "Carrossel (5 imagens)", "Dados do pacote". */
  label: string;
  files: PackageFile[];
};

/**
 * A file a person opens: the texts, the slides and every article image (a linked or missing
 * image stays listed, with why it does not leave). Never the .zip, the JSON or a format this
 * runtime cannot produce.
 */
function readable(file: PackageFile): boolean {
  if (file.format === 'zip' || file.format === 'json') return false;
  if (file.kind === 'image') return true;
  return file.available && (file.kind === 'article' || file.kind === 'carousel');
}

/** Data that leaves with the package without being read: the carousel's JSON, then the manifest. */
function dataFiles(files: readonly PackageFile[]): PackageFile[] {
  const data = files.filter((file) => file.available && file.format === 'json');
  return [...data.filter((file) => file.kind !== 'manifest'), ...data.filter((file) => file.kind === 'manifest')];
}

/**
 * "Arquivos do pacote": the article (its texts, then its images), the carousel slides and, last,
 * the data that leaves with them. Download links are the screen's only way to hand a file to the
 * browser (no .zip yet), so every file that leaves keeps a row; the formats this runtime cannot
 * produce are not listed.
 */
export function groupFiles(files: readonly PackageFile[]): FileGroup[] {
  const shown = files.filter(readable);
  const article = [...shown.filter((file) => file.kind === 'article'), ...shown.filter((file) => file.kind === 'image')];
  const slides = shown.filter((file) => file.kind === 'carousel').sort((a, b) => (a.slideIndex ?? 0) - (b.slideIndex ?? 0));
  const images = slides.filter((file) => file.slideIndex !== undefined).length;
  const data = dataFiles(files);
  const groups: FileGroup[] = [];
  if (article.length > 0) groups.push({ id: 'article', label: 'Artigo', files: article });
  if (slides.length > 0) groups.push({ id: 'carousel', label: `Carrossel (${images} ${images === 1 ? 'imagem' : 'imagens'})`, files: slides });
  if (data.length > 0) groups.push({ id: 'record', label: 'Dados do pacote', files: data });
  return groups;
}

/** A format of "Baixar só" ("Artigo em Markdown (.md)"). */
export type FormatChoice = { id: string; label: string; files: PackageFile[] };

const ONLY_CHOICES: readonly { id: string; label: string; match: (file: PackageFile) => boolean }[] = [
  { id: 'article:md', label: 'Artigo em Markdown (.md)', match: (file) => file.kind === 'article' && file.format === 'md' },
  { id: 'article:html', label: 'Artigo em HTML (.html)', match: (file) => file.kind === 'article' && file.format === 'html' },
  { id: 'carousel:png', label: 'Slides em imagem (.png)', match: (file) => file.kind === 'carousel' && file.format === 'png' },
  { id: 'carousel:pdf', label: 'Carrossel em PDF (.pdf)', match: (file) => file.kind === 'carousel' && file.format === 'pdf' },
];

/** "Baixar só": each format the package has available (the PDF only once the runtime makes it). */
export function formatChoices(files: readonly PackageFile[]): FormatChoice[] {
  return ONLY_CHOICES.map((choice) => ({ id: choice.id, label: choice.label, files: files.filter((file) => file.available && choice.match(file)) })).filter(
    (choice) => choice.files.length > 0,
  );
}

/** "Slide 1", "Markdown", "HTML": the row's second line. */
export function fileCaption(file: PackageFile): string {
  if (file.slideIndex !== undefined) return `Slide ${file.slideIndex + 1}`;
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

// ── What the screen says (COPY §8) ───────────────────────────────────────────────────────

/** The one notice of Entrega when the package is coherent and nothing left yet. */
export const READY_NOTICE = 'Pronto para entregar.';

/** A carousel made from an earlier article version than the one approved now. */
export const OUTDATED_NOTICE = 'O carrossel foi feito a partir de uma versão anterior do artigo.';

type Instant = Date | string;

/** Distinct files that left in a successful attempt (the manifest included). */
export function deliveredFiles(delivery: Pick<Delivery, 'attempts'>): number {
  return new Set(delivery.attempts.filter((attempt) => attempt.status === 'succeeded').flatMap((attempt) => attempt.items ?? [])).size;
}

/** When the package fully left: the last successful attempt (else the delivery's own date). */
export function deliveredAt(delivery: Pick<Delivery, 'attempts' | 'createdAt'>): string {
  return [...delivery.attempts].reverse().find((attempt) => attempt.status === 'succeeded')?.at ?? delivery.createdAt;
}

/** "Entregue em 08/10, 14:20 · 9 arquivos." */
export function deliveredNotice(delivery: Pick<Delivery, 'attempts' | 'createdAt'>, now?: Instant): string {
  const files = deliveredFiles(delivery);
  return `Entregue em ${formatDayTime(deliveredAt(delivery), now)} · ${files} ${files === 1 ? 'arquivo' : 'arquivos'}.`;
}

/** "aprovado por Pedro em 08/10" (no name: "aprovado em 08/10"; no date: "aprovado por Pedro"). */
function approvedBy(name: string | null | undefined, at: Instant | undefined, now?: Instant): string {
  const who = firstName(name);
  return ['aprovado', who ? `por ${who}` : null, at ? `em ${formatDayMonth(at, now)}` : null].filter(Boolean).join(' ');
}

/** Article card: "1,6 lauda · aprovado por Pedro em 08/10". */
export function articleLine(input: { characters?: number; approverName?: string | null; approvedAt?: Instant; now?: Instant }): string {
  return [input.characters !== undefined ? formatLaudas(input.characters) : null, approvedBy(input.approverName, input.approvedAt, input.now)].filter(Boolean).join(' · ');
}

/** Carousel caption: "5 slides · aprovado por Juliana em 08/10". */
export function carouselLine(input: { slides: number; approverName?: string | null; approvedAt?: Instant; now?: Instant }): string {
  return [`${input.slides} ${input.slides === 1 ? 'slide' : 'slides'}`, approvedBy(input.approverName, input.approvedAt, input.now)].join(' · ');
}

/** "2 imagens sem arquivo." / "1 imagem sem arquivo." (suggested images nobody filled). */
export function pendingImagesLine(count: number): string | undefined {
  if (count <= 0) return undefined;
  return count === 1 ? '1 imagem sem arquivo.' : `${count} imagens sem arquivo.`;
}

/** "9 arquivos · 489 KB": every file that leaves in the package; the size once it is prepared. */
export function packageMeta(files: readonly PackageFile[], bytes: number, formatBytes: (bytes: number) => string): string {
  const count = deliverableFiles(files).length;
  return [`${count} ${count === 1 ? 'arquivo' : 'arquivos'}`, bytes > 0 ? formatBytes(bytes) : null].filter(Boolean).join(' · ');
}

/** Entrega before everything is approved: what is missing and the piece to open. */
export function blockedCopy(kind: PieceKind): { title: string; description: string; action: string } {
  const piece = kind === 'carousel' ? 'carrossel' : 'artigo';
  return { title: 'A entrega abre quando tudo estiver aprovado', description: `Falta aprovar o ${piece}.`, action: `Abrir o ${piece}` };
}

/** "Pacote baixado · 9 arquivos", or "Baixamos 7 de 9 arquivos" when some failed. */
export function downloadToast(saved: number, total: number): { title: string; partial: boolean } {
  if (saved >= total) return { title: `Pacote baixado · ${total} ${total === 1 ? 'arquivo' : 'arquivos'}`, partial: false };
  return { title: `Baixamos ${saved} de ${total} ${total === 1 ? 'arquivo' : 'arquivos'}`, partial: true };
}
