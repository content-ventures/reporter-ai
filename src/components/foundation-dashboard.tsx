"use client";

import {
  Alert,
  Badge,
  DescriptionList,
  MetricStrip,
  PageHeader,
  PageStack,
  Panel,
  Section,
} from "@content-ventures/design-system/v3";
import { ReporterShell } from "@/components/reporter-shell";

const releaseMetrics = [
  {
    label: "Release atual",
    value: "R0",
    hint: "Fundação do projeto",
  },
  {
    label: "Próximo marco",
    value: "R1",
    hint: "Primeiro entregável",
  },
  {
    label: "Releases planejadas",
    value: "8",
    hint: "R0 a R7",
  },
  {
    label: "Base visual",
    value: "V3",
    hint: "Design System oficial",
  },
];

const technicalFoundation = [
  { label: "Framework", value: "Next.js 16" },
  { label: "Interface", value: "React 19" },
  { label: "Linguagem", value: "TypeScript" },
  { label: "Roteamento", value: "App Router" },
  { label: "Runtime", value: "Node.js ≥ 20.9" },
  { label: "Pacotes", value: "pnpm 10" },
];

const governance = [
  { label: "Produto", value: "Pedro" },
  { label: "Desenvolvimento", value: "João" },
  { label: "Revisão técnica", value: "Venâncio" },
];

const approvedSequence = [
  { label: "R1", value: "Transcrição → artigo → aprovação → carrossel" },
  { label: "R2", value: "Hard News" },
  { label: "R3", value: "Evergreen" },
  { label: "R4", value: "Cortes de podcast" },
  { label: "R5–R7", value: "Geração multimídia → distribuição → escala" },
];

export function FoundationDashboard() {
  return (
    <ReporterShell active="overview" breadcrumb="Visão geral">
      <PageStack id="overview">
        <PageHeader
          title="Reporter IA"
          description="Fundação técnica para os fluxos de produção editorial da Content Ventures."
          status={
            <Badge tone="gray" variant="text">
              Em desenvolvimento
            </Badge>
          }
          meta={["R0 · Fundação do projeto", "App Router", "Design System V3"]}
        />

        <Alert tone="info" title="Escopo da R0">
          Esta etapa prepara a base do produto. Os fluxos editoriais começam na R1.
        </Alert>

        <MetricStrip
          label="Resumo da fundação"
          items={releaseMetrics}
        />

        <Panel label="Fundação técnica" padding="lg">
          <Section id="technical-base" title="Base técnica">
            <DescriptionList
              label="Tecnologias da fundação"
              items={technicalFoundation}
              layout="grid"
              columns={3}
            />
          </Section>

          <Section id="design-system" title="Design System">
            <DescriptionList
              label="Integração visual"
              items={[
                {
                  label: "Pacote",
                  value: "@content-ventures/design-system",
                },
                { label: "API pública", value: "@content-ventures/design-system/v3" },
                { label: "Tema", value: "ThemeV3" },
                { label: "Tipografia", value: "Inter V3" },
              ]}
              layout="grid"
              columns={2}
            />
          </Section>

          <Section id="roadmap" title="Sequência aprovada">
            <DescriptionList
              label="Próximas releases"
              items={approvedSequence}
              labelWidth={112}
            />
          </Section>

          <Section title="Governança">
            <DescriptionList
              label="Responsáveis pelo produto"
              items={governance}
              layout="grid"
              columns={3}
            />
          </Section>
        </Panel>
      </PageStack>
    </ReporterShell>
  );
}
