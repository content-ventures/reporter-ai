"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ActionBar, Alert, Button, DescriptionList, Dropzone, FormRow, FormSection,
  Input, PageHeader, PageStack, Panel, Section, Segmented, SplitLayout, Stepper, Textarea, toast,
} from "@content-ventures/design-system/v3";
import { ArrowLeft, ArrowRight } from "@content-ventures/design-system/v3/icons";
import { ReporterShell } from "@/components/reporter-shell";
import { useEditorial } from "@/components/editorial-provider";
import { exampleInput, makeDraft } from "@/data/editorial-demo";

export const workflowSteps = [
  { id: "source", label: "Transcrição" }, { id: "article", label: "Artigo" },
  { id: "carousel", label: "Carrossel" }, { id: "export", label: "Exportação" },
];

export function ProductionIntake() {
  const router = useRouter();
  const { add } = useEditorial();
  const [input, setInput] = useState({ title: "", source: "", participants: "", context: "", transcript: "" });
  const [mode, setMode] = useState<"paste" | "upload">("paste");
  const [submitted, setSubmitted] = useState(false);
  const [fileError, setFileError] = useState("");
  const change = (key: keyof typeof input, value: string) => setInput((current) => ({ ...current, [key]: value }));
  function generate() {
    setSubmitted(true);
    if (!input.title.trim() || input.transcript.trim().length < 40) return;
    const id = add(makeDraft(input));
    router.push(`/productions/${id}`);
    toast("Rascunho de demonstração pronto", { tone: "success" });
  }
  return <ReporterShell active="productions" breadcrumb="Nova produção">
    <PageStack>
      <PageHeader title="Nova produção" description="Comece pela conversa que você quer transformar em conteúdo."
        actions={<Button onClick={() => { setInput(exampleInput); setMode("paste"); setFileError(""); }}>Usar exemplo</Button>} />
      <Stepper label="Etapas da produção" steps={workflowSteps} current={0} />
      <SplitLayout main={<PageStack>
        <FormSection title="Material de origem" open state="active">
          <FormRow label="Título da produção" required error={submitted && !input.title.trim() ? "Informe um título." : undefined}>
            {({ id, describedBy, invalid }) => <Input id={id} aria-describedby={describedBy} invalid={invalid}
              value={input.title} onChange={(event) => change("title", event.target.value)} placeholder="Ex.: Uma conversa sobre o futuro do conteúdo" />}
          </FormRow>
          <FormRow label="Transcrição" required error={submitted && input.transcript.trim().length < 40 ? "Inclua pelo menos 40 caracteres da conversa." : undefined}>
            {({ id, describedBy, invalid }) => <PageStack>
              <Segmented label="Entrada da transcrição" size="sm" value={mode} onChange={setMode} options={[
                { value: "paste", label: "Colar texto" }, { value: "upload", label: "Enviar arquivo" },
              ]} />
              {mode === "upload" && <Dropzone accept=".txt,text/plain" maxSize={2 * 1024 * 1024}
                spec="TXT · até 2 MB" title="Solte sua transcrição aqui" onFiles={async (files, rejected) => {
                  if (rejected.length) { setFileError("Envie um arquivo TXT de até 2 MB."); return; }
                  if (files[0]) {
                    try { change("transcript", await files[0].text()); setFileError(""); }
                    catch { setFileError("Não foi possível ler o arquivo. Tente novamente ou cole o texto."); }
                  }
                }} />}
              {fileError && <Alert tone="danger" compact>{fileError}</Alert>}
              <Textarea id={id} aria-describedby={describedBy} invalid={invalid} rows={12}
                value={input.transcript} onChange={(event) => change("transcript", event.target.value)}
                placeholder="Cole aqui a transcrição completa da entrevista, conversa ou podcast…" />
            </PageStack>}
          </FormRow>
        </FormSection>
        <FormSection title="Contexto editorial" open state="active">
          <FormRow label="Origem"><Input aria-label="Origem" value={input.source} onChange={(event) => change("source", event.target.value)} placeholder="Nome da entrevista, episódio ou evento" /></FormRow>
          <FormRow label="Participantes"><Input aria-label="Participantes" value={input.participants} onChange={(event) => change("participants", event.target.value)} placeholder="Quem participou da conversa?" /></FormRow>
          <FormRow label="Enfoque" optional><Textarea aria-label="Enfoque editorial" rows={3} value={input.context} onChange={(event) => change("context", event.target.value)} placeholder="O que o artigo deve destacar?" /></FormRow>
        </FormSection>
      </PageStack>} aside={<Panel label="Orientações da produção">
        <Section title="Uma fonte, duas entregas"><DescriptionList label="Entregas previstas" labelWidth={90} items={[
          { label: "Artigo", value: "Rascunho para revisão" }, { label: "Carrossel", value: "Slides a partir do artigo aprovado" },
        ]} /></Section>
        <Section title="Antes de continuar">Confira o texto e identifique os participantes. A fonte acompanhará todas as etapas da produção.</Section>
      </Panel>} asideLabel="Orientações" />
      <ActionBar position="static" start={<Button variant="ghost" icon={ArrowLeft} onClick={() => router.push("/")}>Voltar</Button>}>
        <Button variant="primary" trailingIcon={ArrowRight} onClick={generate}>Gerar artigo</Button>
      </ActionBar>
    </PageStack>
  </ReporterShell>;
}
