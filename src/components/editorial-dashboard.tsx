"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardHeader,
  CardLink,
  DataTable,
  EmptyState,
  FilterBar,
  IconTile,
  KanbanBoard,
  KanbanCardMeta,
  KanbanCardRow,
  KanbanColumn,
  List,
  ListItem,
  MetricStrip,
  PageHeader,
  PageStack,
  Panel,
  Reveal,
  SearchField,
  Section,
  Segmented,
  SplitLayout,
  StepperCompact,
  Tabs,
  type Column,
  type Tone,
} from "@content-ventures/design-system/v3";
import {
  ArrowRight,
  CheckCircle2,
  Columns3,
  FileText,
  FileUp,
  LayoutList,
  LayoutTemplate,
  PenLine,
  Plus,
} from "@content-ventures/design-system/v3/icons";
import { ReporterShell } from "@/components/reporter-shell";
import { useEditorial } from "@/components/editorial-provider";
import { stages, type Production, type Stage } from "@/data/editorial-demo";

const statuses: Record<Stage, { label: string; tone: Tone }> = {
  source: { label: "Material recebido", tone: "gray" },
  article: { label: "Aguardando revisão", tone: "violet" },
  carousel: { label: "Artigo aprovado", tone: "teal" },
  ready: { label: "Pronto para exportar", tone: "green" },
};

const stageIcons = {
  source: FileUp,
  article: PenLine,
  carousel: LayoutTemplate,
  ready: CheckCircle2,
} satisfies Record<Stage, typeof FileText>;

const progressSteps = stages.map(({ id, label }) => ({ id, label }));

export function ProductionStatus({ stage }: { stage: Stage }) {
  return <Badge tone={statuses[stage].tone} variant="text" size="sm">{statuses[stage].label}</Badge>;
}

function HomeDashboard({ productions, onOpen, onNew, onSeeAll }: {
  productions: Production[];
  onOpen: (item: Production) => void;
  onNew: () => void;
  onSeeAll: () => void;
}) {
  const ready = productions.filter((item) => item.stage === "ready");
  const review = productions.filter((item) => item.stage === "article" || item.stage === "carousel");
  const featured = review[0] ?? productions[0];
  const featuredStage = featured ? Math.max(0, stages.findIndex((stage) => stage.id === featured.stage)) : 0;

  return (
    <ReporterShell active="overview" breadcrumb="Visão geral">
      <PageStack>
        <PageHeader
          title="Olá, João"
          description={review.length ? `Você tem ${review.length} conteúdos aguardando sua revisão.` : "Sua fila editorial está em dia."}
          actions={<Button variant="primary" icon={Plus} onClick={onNew}>Nova produção</Button>}
        />

        {featured && (
          <Reveal appear>
            <SplitLayout
              asideLabel="Fila de revisão"
              main={
                <Section title="Continue de onde parou" variant="panel" meta={featured.updated}>
                  <CardHeader
                    size="md"
                    leading={<IconTile icon={stageIcons[featured.stage]} tone={statuses[featured.stage].tone} size="lg" />}
                    title={featured.title}
                    description={`${featured.source} · ${featured.owner}`}
                    badge={<ProductionStatus stage={featured.stage} />}
                  />
                  <StepperCompact
                    steps={progressSteps}
                    current={featuredStage}
                    label="Progresso da produção"
                    actions={
                      <Button size="sm" variant="primary" trailingIcon={ArrowRight} onClick={() => onOpen(featured)}>
                        {stages[featuredStage]?.action ?? "Continuar"}
                      </Button>
                    }
                  />
                </Section>
              }
              aside={
                <Panel label="Sua fila editorial">
                  <Section title="Sua fila de revisão" meta={String(review.length)}>
                    <List label="Conteúdos aguardando sua revisão" framed={false} empty="Nada aguardando revisão.">
                      {review.slice(0, 4).map((item) => (
                        <ListItem
                          key={item.id}
                          leading={<IconTile icon={stageIcons[item.stage]} tone={statuses[item.stage].tone} size="sm" />}
                          title={item.title}
                          description={statuses[item.stage].label}
                          meta={item.updated}
                          onClick={() => onOpen(item)}
                        />
                      ))}
                    </List>
                  </Section>
                </Panel>
              }
            />
          </Reveal>
        )}

        <MetricStrip label="Ritmo editorial" columns={3} items={[
          { label: "Em andamento", value: String(productions.length - ready.length) },
          { label: "Aguardando revisão", value: String(review.length) },
          { label: "Prontas para exportar", value: String(ready.length) },
        ]} />

        <Reveal appear>
          <Section
            title="Produções recentes"
            variant="panel"
            action={<Button variant="ghost" size="sm" trailingIcon={ArrowRight} onClick={onSeeAll}>Ver todas</Button>}
          >
            <List label="Produções recentes" framed={false}>
              {productions.slice(0, 5).map((item) => (
                <ListItem
                  key={item.id}
                  leading={<Avatar name={item.owner} size="sm" decorative />}
                  title={item.title}
                  description={`${item.owner} · ${item.updated}`}
                  meta={<ProductionStatus stage={item.stage} />}
                  onClick={() => onOpen(item)}
                />
              ))}
            </List>
          </Section>
        </Reveal>
      </PageStack>
    </ReporterShell>
  );
}

function ProductionCollection({ productions, onOpen, onNew }: {
  productions: Production[];
  onOpen: (item: Production) => void;
  onNew: () => void;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "review" | "ready">("all");
  const [view, setView] = useState<"board" | "list">("list");
  const ready = productions.filter((item) => item.stage === "ready").length;
  const review = productions.filter((item) => item.stage === "article" || item.stage === "carousel").length;
  const filtered = productions.filter((item) =>
    `${item.title} ${item.owner}`.toLocaleLowerCase("pt-BR").includes(query.toLocaleLowerCase("pt-BR")) &&
    (filter === "all" || (filter === "ready" ? item.stage === "ready" : item.stage === "article" || item.stage === "carousel")));
  const columns: Column<Production>[] = [
    { key: "title", header: "Produção", render: (item) => item.title, width: "38%" },
    { key: "stage", header: "Etapa", render: (item) => stages.find((stage) => stage.id === item.stage)?.label },
    { key: "status", header: "Status", render: (item) => <ProductionStatus stage={item.stage} /> },
    { key: "owner", header: "Responsável", render: (item) => item.owner },
    { key: "updated", header: "Atualização", render: (item) => item.updated },
  ];

  return (
    <ReporterShell active="productions" breadcrumb="Produções">
      <PageStack>
        <PageHeader title="Produções" description="Acompanhe cada conteúdo da entrada à entrega."
          actions={<Button variant="primary" icon={Plus} onClick={onNew}>Nova produção</Button>}
        />
        <Section>
          <FilterBar filters={false} filtersOpen={false} onFiltersOpenChange={() => {}}
            tabs={<Tabs label="Filtrar produções" size="sm" value={filter} onChange={setFilter} items={[
              { value: "all", label: "Todas", count: productions.length },
              { value: "review", label: "Para revisar", count: review },
              { value: "ready", label: "Concluídas", count: ready },
            ]} />}
            search={<SearchField label="Buscar produções" placeholder="Buscar produção…" value={query} onValueChange={setQuery} size="sm" />}
            actions={<Segmented label="Visualização" size="sm" value={view} onChange={setView} options={[
              { value: "board", label: "Quadro", icon: Columns3, iconOnly: true },
              { value: "list", label: "Lista", icon: LayoutList, iconOnly: true },
            ]} />}
          />
          {!filtered.length ? <EmptyState icon={FileText} title="Nenhuma produção encontrada"
            actions={<Button onClick={() => { setQuery(""); setFilter("all"); }}>Limpar busca e filtros</Button>} />
            : view === "list" ? <DataTable label="Produções editoriais" rows={filtered} rowKey={(item) => item.id}
              columns={columns} onRowClick={onOpen} rowLabel={(item) => item.title} />
            : <KanbanBoard label="Fluxo editorial por etapa">
              {stages.map((stage) => <KanbanColumn key={stage.id} title={stage.label}
                count={filtered.filter((item) => item.stage === stage.id).length}
                countNoun={{ singular: "produção", plural: "produções" }} width={260}
                empty="Nenhuma produção nesta etapa">
                {filtered.filter((item) => item.stage === stage.id).map((item) => <Card
                  key={item.id} as="article" role="listitem" interactive padding="md">
                  <CardHeader divided size="md" title={<CardLink onClick={() => onOpen(item)}>{item.title}</CardLink>} />
                  <ProductionStatus stage={item.stage} />
                  <KanbanCardRow><KanbanCardMeta>{item.updated}</KanbanCardMeta><Avatar name={item.owner} size="xs" /></KanbanCardRow>
                  <Button variant="ghost" size="sm" trailingIcon={ArrowRight} onClick={(event) => { event.stopPropagation(); onOpen(item); }}>
                    {stage.action}
                  </Button>
                </Card>)}
              </KanbanColumn>)}
            </KanbanBoard>}
        </Section>
      </PageStack>
    </ReporterShell>
  );
}

export function EditorialDashboard({ listing = false }: { listing?: boolean }) {
  const router = useRouter();
  const { productions } = useEditorial();
  const open = (item: Production) => router.push(`/productions/${item.id}`);
  const create = () => router.push("/productions/new");

  return listing
    ? <ProductionCollection productions={productions} onOpen={open} onNew={create} />
    : <HomeDashboard productions={productions} onOpen={open} onNew={create} onSeeAll={() => router.push("/productions")} />;
}
