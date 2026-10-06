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
  Timeline,
  type TimelineEntry,
} from "@content-ventures/design-system/v3";
import { ReporterShell } from "@/components/reporter-shell";
import releaseHistory from "@/data/release-history.json";

const versionPolicy = [
  {
    label: "X · Major",
    value: "Release comercial",
    hint: "R1 = v1.0.0, R2 = v2.0.0",
  },
  {
    label: "Y · Minor",
    value: "Feature relevante",
    hint: "Incrementa dentro da release",
  },
  {
    label: "Z · Patch",
    value: "Correção ou ajuste",
    hint: "Mantém X e Y",
  },
];

function changeItems(changes: Array<{ type: string; description: string }>) {
  const groups = new Map<string, string[]>();

  for (const change of changes) {
    groups.set(change.type, [...(groups.get(change.type) ?? []), change.description]);
  }

  return [...groups.entries()].map(([type, descriptions]) => ({
    label: type,
    value: descriptions.join(" · "),
  }));
}

const releaseItems: TimelineEntry[] = releaseHistory.releases.map((release, index) => ({
  id: release.version,
  title: `v${release.version} · ${release.title}`,
  description: release.summary,
  date: release.date,
  dateTime: release.date,
  state: index === 0 ? "current" : "done",
  badge: (
    <Badge tone={index === 0 ? "blue" : "gray"} variant="soft" size="sm">
      {release.roadmapRelease}
    </Badge>
  ),
  extra: (
    <DescriptionList
      label={`Changes in version ${release.version}`}
      items={changeItems(release.changes)}
      labelWidth={96}
    />
  ),
}));

export function VersionHistory() {
  return (
    <ReporterShell active="versions" breadcrumb="Versões">
      <PageStack>
        <PageHeader
          eyebrow="Governança de releases"
          title="Versões do Reporter IA"
          description="Histórico público do produto e contrato de evolução das releases."
          status={
            <Badge tone="blue" variant="text">
              v{releaseHistory.currentVersion}
            </Badge>
          }
          meta={[
            `${releaseHistory.currentRoadmapRelease} · Fundação`,
            "Semantic Versioning",
            "Release manual controlada",
          ]}
        />

        <Alert tone="info" title="Versionamento ligado ao deploy">
          Toda release de produção deve atualizar o número, a descrição, o changelog e este histórico antes do deploy.
        </Alert>

        <MetricStrip label="Política de versionamento semântico" items={versionPolicy} columns={3} />

        <Panel label="Histórico de versões" padding="lg">
          <Section
            title="Histórico publicado"
            meta={`${releaseHistory.releases.length} versão publicada`}
          >
            <Timeline label="Versões publicadas" items={releaseItems} variant="steps" />
          </Section>
        </Panel>
      </PageStack>
    </ReporterShell>
  );
}
