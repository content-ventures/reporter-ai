'use client';
import { useWorkspaceHref } from '@/ui/workspace-navigation';

import { Suspense, useState } from 'react';
import {
  Alert,
  Button,
  ButtonLink,
  DescriptionList,
  EmptyState,
  ErrorState,
  LinkButton,
  List,
  ListItemSkeleton,
  Panel,
  Section,
  Segmented,
  SplitButton,
  SplitLayout,
  toast,
  Tooltip,
  type MediaRatio,
  type MenuItem,
} from '@content-ventures/design-system/v3';
import { BookOpen, Download, Lock, Package, TriangleAlert } from '@content-ventures/design-system/v3/icons';
import { eventBoxLines, PIECE_LABELS, type MixedVersionsDetails, type PieceKind, type ProductionId, type VersionRef } from '@/domain';
import type { DeliveryView, PackageFile, PieceView } from '@/ports';
import { useCan, useCommands, useDelivery, useRuntime, useSimulation } from '@/state';
import { plural } from '@/ui/format';
import { pieceHref, reviewHref } from '@/ui/routes';
import { useCommandGroup } from '@/ui/shell';
import { ProductionHeader, StagePage, useProductionFrame } from '@/features/production/production-frame';
import { ArticleFinal } from './article-final';
import { CopyArticleButton } from './copy-article-button';
import { DeliveryAside } from './delivery-aside';
import {
  blockedCopy,
  blockingPiece,
  deliverableFiles,
  downloadedOutcomes,
  DELIVERED_NOTE,
  downloadToast,
  fileOutcomes,
  formatChoices,
  imageWarningLine,
  imageWarnings,
  pendingFailures,
  traceRuns,
} from './delivery-model';
import { DeliveredPieces } from './delivered-pieces';
import { PackagePanel } from './package-panel';
import { PilotFeedbackPanel } from './pilot-feedback';
import { useDeliveryView, type DeliveryTab } from './use-delivery-view';
import { usePackage, type PackageController } from './use-package';
import { notifyRefusal } from '@/ui/permission-dialog';
import { isReleased } from '@/registries';
import { DeskPublication } from '@/features/hard-news/delivery/cms-publication';
import { useDossier } from '@/features/hard-news/state/hard-news-provider';

/** Simulation scenario of the local ExportService: one file fails once (⌘K › Entrega). */
const EXPORT_PARTIAL_SCENARIO = 'export-partial';

function LoadingDelivery() {
  return (
    <SplitLayout
      main={
        <Panel padding="lg">
          <Section title="Arquivos do pacote">
            <List label="Arquivos do pacote" framed={false}>
              <ListItemSkeleton />
              <ListItemSkeleton />
              <ListItemSkeleton />
              <ListItemSkeleton />
              <ListItemSkeleton />
            </List>
          </Section>
        </Panel>
      }
      aside={
        <Panel>
          <Section title="Entrega">
            <DescriptionList items={[]} loading loadingRows={4} label="Registro da entrega" />
          </Section>
        </Panel>
      }
    />
  );
}

/** Entrega opens only after both approvals: say what is missing and open the piece that blocks it. */
function BlockedDelivery({ productionId, reason, pieces, plan }: { productionId: ProductionId; reason?: string; pieces: readonly PieceView[]; plan: readonly PieceKind[] }) {
  const workspaceHrefFor = useWorkspaceHref();
  const piece = blockingPiece(pieces, plan);
  const copy = piece ? blockedCopy(piece.kind) : undefined;
  return (
    <EmptyState
      icon={Lock}
      size="page"
      title={copy?.title ?? 'A entrega abre quando tudo estiver aprovado'}
      description={copy?.description ?? reason ?? 'Aprove as peças da produção para liberar a entrega.'}
      actions={
        piece && copy ? (
          <ButtonLink href={workspaceHrefFor(piece.pendingReview ? reviewHref(productionId, piece.kind) : pieceHref(productionId, piece.kind))} variant="primary">
            {copy.action}
          </ButtonLink>
        ) : undefined
      }
    />
  );
}

/** Mixed versions (REQ-1.6): only two ways out — export with the parent it was made from, or update it. */
function mixedDescription(view: DeliveryView, pieces: readonly PieceView[]): string | undefined {
  if (view.result.ok) return undefined;
  const details = view.result.refusal.details as Partial<MixedVersionsDetails> | undefined;
  const parent = details?.derivedFrom && pieces.find((piece) => piece.id === details.derivedFrom?.pieceId);
  if (!details?.derivedFrom || !details.parentInPackage || !parent) return view.result.refusal.message;
  const label = PIECE_LABELS[parent.kind].toLowerCase();
  return `Feito a partir do ${label} v${details.derivedFrom.number}. O ${label} aprovado agora está na v${details.parentInPackage.number}.`;
}

function IncoherentPackage({
  view,
  pieces,
  productionId,
  onExportWithParent,
}: {
  view: DeliveryView;
  pieces: readonly PieceView[];
  productionId: ProductionId;
  onExportWithParent: (selection: VersionRef[]) => void;
}) {
  const workspaceHrefFor = useWorkspaceHref();
  const { exportWithParent, updateDerivative } = view.alternatives;
  const derivative = updateDerivative ? PIECE_LABELS[updateDerivative.kind] : 'Peça derivada';
  return (
    <Panel padding="lg">
      <Section title="Pacote">
        <EmptyState
          icon={TriangleAlert}
          title={`${derivative} desatualizado`}
          description={mixedDescription(view, pieces)}
          actions={
            <>
              {updateDerivative ? (
                <ButtonLink href={workspaceHrefFor(pieceHref(productionId, updateDerivative.kind))} variant="primary">
                  {updateDerivative.label}
                </ButtonLink>
              ) : null}
              {exportWithParent ? <Button onClick={() => onExportWithParent(exportWithParent.selection)}>{exportWithParent.label}</Button> : null}
            </>
          }
        />
      </Section>
    </Panel>
  );
}

/** "Baixar só": each format the package has, enabled once its files are prepared. */
function downloadMenu(pkg: PackageController): MenuItem[] {
  return formatChoices(pkg.plan?.files ?? []).map((choice) => {
    const ready = choice.files.filter((file) => pkg.progress[file.fileName]?.state === 'ready').map((file) => file.fileName);
    return {
      label: choice.label,
      meta: choice.files.length > 1 ? String(choice.files.length) : undefined,
      disabled: ready.length === 0,
      onSelect: () => void pkg.download(ready),
    };
  });
}

/**
 * Entrega (`/productions/[id]/delivery`, PLAN §3.8). Blocked until every planned piece is
 * approved; a carousel made from another article version only offers "Exportar com artigo vN"
 * or "Atualizar carrossel". Otherwise the exact package is prepared file by file and "Baixar
 * pacote" saves it and records the delivery (channel, mode, attempts, idempotency key) — a
 * partial failure is retried per file. Rastreabilidade and "Retorno do piloto" sit beside it.
 * "Ver: Pacote · Artigo final" (in the URL) switches to the approved article read as it leaves, centred
 * on the screen, so it can be read before downloading.
 */
export function DeliveryScreen({ productionId }: { productionId: ProductionId }) {
  return (
    <Suspense
      fallback={
        <StagePage header={<ProductionHeader />} label="Entrega">
          <LoadingDelivery />
        </StagePage>
      }
    >
      <DeliveryRoute productionId={productionId} />
    </Suspense>
  );
}

const TAB_OPTIONS: { value: DeliveryTab; label: string }[] = [
  { value: 'package', label: 'Pacote' },
  // "Artigo final": the header's journey menu already has an "Artigo" stage.
  { value: 'article', label: 'Artigo final' },
];

function DeliveryRoute({ productionId }: { productionId: ProductionId }) {
  const workspaceHrefFor = useWorkspaceHref();
  const frame = useProductionFrame();
  const { tab, setTab } = useDeliveryView();
  const commands = useCommands();
  const { runtime } = useRuntime();
  const simulation = useSimulation();
  // Downloading the package and the pilot feedback are for who edits; others read what leaves.
  const canDeliver = useCan('delivery.record');
  const canGiveFeedback = useCan('feedback.record');
  const [override, setOverride] = useState<VersionRef[] | undefined>();
  const delivery = useDelivery(productionId, override);
  const view = delivery.data;
  const exportable = view && view.available && view.result.ok ? view.selection : undefined;
  const pkg = usePackage(productionId, exportable);
  const [exporting, setExporting] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  // R2: a covered news story goes to the portal's CMS; the package download becomes secondary.
  const desk = useDossier(productionId);

  const templates = runtime?.render.templates() ?? [];
  const templateInfo=(id:string)=>runtime?.render.templateInfo?.(id)??templates.find(template=>template.id===id);
  const templateName = (id: string) => templateInfo(id)?.name;
  const carouselTemplate = view?.items.flatMap(item=>item.templateId?[templateInfo(item.templateId)]:[]).find(Boolean);
  const slideRatio: MediaRatio | undefined = carouselTemplate ? `${carouselTemplate.width}/${carouselTemplate.height}` : undefined;
  const alreadyDelivered = view?.latestDelivery?.status === 'completed';

  async function exportPackage() {
    const plan = pkg.plan;
    const selection = pkg.selection;
    if (exporting) return;
    if (!plan || !selection || pkg.status !== 'ready') {
      if (pkg.status === 'preparing') toast('Pacote em preparação', { tone: 'info', description: `${pkg.done} de ${pkg.total} arquivos` });
      return;
    }
    const prepared = fileOutcomes(plan.files, pkg.progress);
    const ready = prepared.filter((outcome) => outcome.ok).map((outcome) => outcome.fileName);
    setExporting(true);
    if (ready.length === prepared.length && !alreadyDelivered) setCelebrate(true);
    // Only what the browser was actually handed counts as delivered.
    const saved = await pkg.download(ready);
    if (!pkg.isCurrent()) { setExporting(false); setCelebrate(false); return; }
    const outcomes = downloadedOutcomes(prepared, saved);
    const failed = outcomes.filter((outcome) => !outcome.ok).length;
    const result = await commands.production.recordDelivery({ productionId, selection: [...selection], mode: 'download', files: outcomes });
    if (!pkg.isCurrent()) return;
    setExporting(false);
    if (!result.ok) {
      setCelebrate(false);
      notifyRefusal('Não foi possível registrar a entrega', result.refusal);
      return;
    }
    const { title, partial } = downloadToast(saved.length, outcomes.length);
    if (result.value.status === 'completed' && !partial) toast(title, { description: DELIVERED_NOTE });
    else {
      setCelebrate(false);
      toast(title, { tone: 'error', description: plural(failed, 'arquivo falhou', 'arquivos falharam') });
    }
  }

  async function retryFile(file: PackageFile) {
    const ok = await pkg.retry(file.fileName);
    if (!pkg.isCurrent()) return;
    if (!ok) {
      toast('O arquivo falhou de novo', { tone: 'error', description: file.fileName });
      return;
    }
    const latest = view?.latestDelivery;
    const [deliverable] = deliverableFiles([file]);
    const selection = pkg.selection;
    // Already exported with this file missing: it leaves now, completing the delivery.
    if (!latest || latest.status === 'completed' || !deliverable || !selection || !pendingFailures(latest.attempts).has(file.fileName)) return;
    const willComplete = pendingFailures(latest.attempts).size === 1;
    const saved = await pkg.download([file.fileName]);
    if (!pkg.isCurrent()) return;
    if (saved.length === 0) {
      toast('O arquivo não foi baixado', { tone: 'error', description: file.fileName });
      return;
    }
    if (willComplete) setCelebrate(true);
    const result = await commands.production.recordDelivery({
      productionId,
      selection: [...selection],
      mode: 'download',
      files: [{ fileName: deliverable.fileName, format: deliverable.format, ok: true, ...(deliverable.versionId ? { versionId: deliverable.versionId } : {}) }],
    });
    if (!pkg.isCurrent()) return;
    if (result.ok && result.value.status === 'completed') {
      // The whole package is out now: say so as the first download does.
      const total = deliverableFiles(pkg.plan?.files ?? []).length;
      toast(downloadToast(total, total).title, { description: DELIVERED_NOTE });
    }
  }

  // The approved article reads as it leaves whenever it exists, even while the package waits on another piece.
  const articleItem = view?.available ? view.article : undefined;
  const reading = tab === 'article' && articleItem !== undefined;

  const commandItems = [
    ...(exportable && canDeliver ? [{ id: 'delivery-download', label: 'Baixar pacote', icon: Download, onSelect: () => void exportPackage() }] : []),
    ...(articleItem
      ? [
          reading
            ? { id: 'delivery-package', label: 'Ver pacote', icon: Package, onSelect: () => setTab('package') }
            : { id: 'delivery-article', label: 'Ler artigo', icon: BookOpen, onSelect: () => setTab('article') },
        ]
      : []),
    ...(exportable && simulation.available
      ? [{ id: 'delivery-simulate-failure', label: 'Simular falha na exportação', icon: TriangleAlert, onSelect: () => pkg.prepareAgain(EXPORT_PARTIAL_SCENARIO) }]
      : []),
  ];
  useCommandGroup(commandItems.length > 0 ? { label: 'Entrega', items: commandItems } : null);

  const viewSwitch = articleItem ? <Segmented label="Ver" size="sm" value={tab} onChange={setTab} options={TAB_OPTIONS} /> : null;
  // An event format pastes with its linha fina and the event box, as the outlet publishes it.
  const briefOf = frame.production.data?.brief;
  const box = briefOf?.format ? eventBoxLines(briefOf.event) : [];
  const copyText = articleItem ? <CopyArticleButton versionId={articleItem.version.versionId} box={box} /> : null;
  // "Ver no pacote" only where the package lists what was left out (it can be built).
  const finalArticle = reading && articleItem ? <ArticleFinal item={articleItem} {...(exportable ? { onOpenPackage: () => setTab('package') } : {})} /> : null;

  const detail = frame.production.data;

  if (delivery.status === 'error') {
    return (
      <StagePage header={<ProductionHeader />} label="Entrega">
        <ErrorState title="Não foi possível abrir a entrega" onRetry={delivery.retry} size="page" />
      </StagePage>
    );
  }

  if (!view || !detail) {
    return (
      <StagePage header={<ProductionHeader />} label="Entrega">
        <LoadingDelivery />
      </StagePage>
    );
  }

  if (!view.available) {
    return (
      <StagePage header={<ProductionHeader />} label="Entrega">
        <BlockedDelivery productionId={productionId} reason={view.blockedReason} pieces={detail.pieces} plan={detail.plan} />
      </StagePage>
    );
  }

  if (!view.result.ok) {
    return (
      <StagePage header={<ProductionHeader actions={viewSwitch ? <>{viewSwitch}{copyText}</> : null} />} label="Entrega">
        {finalArticle ?? (view.result.refusal.code === 'mixed_versions' ? (
          // The decision, with the record and the traceability of what is approved beside it.
          <SplitLayout
            asideLabel="Registro e rastreabilidade"
            main={<IncoherentPackage view={view} pieces={detail.pieces} productionId={productionId} onExportWithParent={setOverride} />}
            aside={<DeliveryAside view={view} runs={traceRuns(view.items, view.provenance.runs, detail.runs)} celebrate={false} templateName={templateName} />}
          />
        ) : (
          <EmptyState icon={TriangleAlert} size="page" title="Pacote indisponível" description={view.result.refusal.message} />
        ))}
      </StagePage>
    );
  }

  const preparing = pkg.status === 'preparing' || pkg.status === 'idle';
  // Images never block the package (João's call): what they still miss is said before it leaves.
  const imageWarning = imageWarningLine(imageWarnings(pkg.plan?.files ?? view.files));
  const overrideTitle = override ? `Pacote com ${view.items.map((item) => `${item.label.toLowerCase()} v${item.version.number}`).join(' e ')}` : undefined;

  const download = !canDeliver ? null :
    pkg.status === 'refused' ? (
      // Unavailable with its reason (a bare disabled button says nothing).
      <Tooltip content={pkg.refusal?.message ?? 'Não foi possível montar o pacote.'}>
        <Button variant="primary" size="sm" icon={Download} aria-disabled>
          Baixar pacote
        </Button>
      </Tooltip>
    ) : (
      <SplitButton
        label="Baixar pacote"
        icon={Download}
        size="sm"
        variant={desk ? 'secondary' : 'primary'}
        loading={preparing || exporting}
        onClick={() => void exportPackage()}
        menu={[{ label: 'Baixar só', items: downloadMenu(pkg) }]}
        menuLabel="Baixar só"
        menuWidth={280}
      />
    );

  return (
    <StagePage
      label="Entrega"
      header={
        <ProductionHeader
          actions={
            <>
              {viewSwitch}
              {copyText}
              {download}
            </>
          }
        />
      }
    >
      {finalArticle ?? (
        <SplitLayout
          asideLabel="Registro e rastreabilidade"
          main={
            <>
              {overrideTitle ? (
                <Alert tone="info" title={overrideTitle} action={<LinkButton onClick={() => setOverride(undefined)}>Usar versões atuais</LinkButton>} />
              ) : null}
              {pkg.status === 'refused' ? (
                <Alert tone="danger" title="Não foi possível montar o pacote" action={<LinkButton onClick={() => pkg.prepareAgain()}>Tentar de novo</LinkButton>}>
                  {pkg.refusal?.message}
                </Alert>
              ) : null}
              {imageWarning ? (
                <Alert
                  tone="warning"
                  title={imageWarning}
                  action={
                    <ButtonLink href={workspaceHrefFor(pieceHref(productionId, 'article'))} size="sm">
                      Conferir no estúdio
                    </ButtonLink>
                  }
                >
                  As imagens saem no pacote assim mesmo; o manifesto registra crédito e uso autorizado de cada uma.
                </Alert>
              ) : null}
              {isReleased('R2') && desk && articleItem ? (
                <DeskPublication productionId={productionId} versionId={articleItem.version.versionId} versionNumber={articleItem.version.number} owner={detail.owner.name} />
              ) : null}
              <DeliveredPieces items={view.items} pkg={pkg} onReadArticle={() => setTab('article')} {...(slideRatio ? { slideRatio } : {})} />
              <PackagePanel pkg={pkg} onRetry={retryFile} />
            </>
          }
          aside={
            <>
              <DeliveryAside view={view} runs={traceRuns(view.items, view.provenance.runs, detail.runs)} celebrate={celebrate} templateName={templateName} />
              {view.latestDelivery && canGiveFeedback ? <PilotFeedbackPanel productionId={productionId} durations={view.stageDurations} /> : null}
            </>
          }
        />
      )}
    </StagePage>
  );
}
