"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ActionBar, Badge, Button, CardHeader, DescriptionList, EmptyState, ExpandableText, Field, FixedFrame,
  Input, List, ListItem, MediaFrame, MetaList, PageHeader, PageStack, Panel, Section,
  ResizablePanels, Segmented, SplitLayout, Stepper, Textarea, toast,
} from "@content-ventures/design-system/v3";
import { ArrowLeft, ArrowRight, Check, Download, FileText } from "@content-ventures/design-system/v3/icons";
import { ReporterShell } from "@/components/reporter-shell";
import { useEditorial } from "@/components/editorial-provider";
import { ProductionStatus } from "@/components/editorial-dashboard";
import { workflowSteps } from "@/components/production-intake";
import { draftSlides, stages, type Production } from "@/data/editorial-demo";
import { RichTextEditor } from "@/components/editor/rich-text-editor";
import { downloadArticle } from "@/components/editor/article-document";

function downloadText(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ProductionWorkspace({ id }: { id: string }) {
  const { productions } = useEditorial();
  const router = useRouter();
  const item = productions.find((production) => production.id === id);
  if (!item) return <ReporterShell active="productions" breadcrumb="Produção">
    <EmptyState icon={FileText} title="Esta produção não está nesta sessão"
      description="As produções desta prévia ficam disponíveis enquanto a página está aberta."
      actions={<Button onClick={() => router.push("/productions")}>Ver produções</Button>} />
  </ReporterShell>;
  return <ProductionEditor key={id} item={item} />;
}

function ProductionEditor({ item }: { item: Production }) {
  const { update } = useEditorial();
  const router = useRouter();
  const [step, setStep] = useState(stages.findIndex((stage) => stage.id === item.stage));
  const [focusMode, setFocusMode] = useState(false);
  const [slideIndex, setSlideIndex] = useState("0");
  const currentSlide = item.slides[Number(slideIndex)];
  const maximumStep = item.carouselApproved ? 3 : item.articleApproved ? 2 : item.stage === "source" ? 0 : 1;
  function navigateStep(next: number) {
    setStep(next);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function editArticle(patch: Partial<Production>) {
    update(item.id, { ...patch, articleApproved: false, carouselApproved: false, slides: [], stage: "article" });
  }
  function approveArticle() {
    update(item.id, { articleApproved: true, carouselApproved: false, stage: "carousel", slides: draftSlides(item.title, item.article) });
    setSlideIndex("0"); navigateStep(2);
    toast("Artigo aprovado. Revise os slides.", { tone: "success" });
  }
  function editSlide(key: "title" | "body", value: string) {
    update(item.id, {
      slides: item.slides.map((slide, index) => index === Number(slideIndex) ? { ...slide, [key]: value } : slide),
      carouselApproved: false, stage: "carousel",
    });
  }
  const sourcePanel = <Panel label="Fonte da produção">
    <Section title="Material de origem"><DescriptionList label="Origem do conteúdo" labelWidth={96} items={[
      { label: "Origem", value: item.source }, { label: "Participantes", value: item.participants },
      { label: "Responsável", value: item.owner },
    ]} /></Section>
    <Section title="Enfoque">{item.context || "Não informado"}</Section>
    <Section title="Transcrição"><ExpandableText lines={9}>{item.transcript}</ExpandableText></Section>
  </Panel>;
  return <ReporterShell active="productions" breadcrumb={workflowSteps[step].label} focused={focusMode && step === 1}>
    <PageStack>
      {!(focusMode && step === 1) && <PageHeader title={step === 1 ? "Estúdio de escrita" : item.title} variant={step === 1 ? "frame" : "page"} meta={[item.source || "Transcrição", item.updated]}
        status={<ProductionStatus stage={item.stage} />}
        actions={<><Button variant="ghost" onClick={() => router.push("/productions")}>Ver produções</Button>{step === 1 && <Button variant="primary" icon={Check} disabled={!item.title.trim() || !item.article.trim()}
          onClick={item.articleApproved ? () => navigateStep(2) : approveArticle}>{item.articleApproved ? "Ver carrossel" : "Aprovar artigo"}</Button>}</>} />}
      {step !== 1 && <Stepper label="Etapas da produção" steps={workflowSteps} current={step}
        onStepSelect={navigateStep} canSelect={(index) => index <= maximumStep} />}

      {step === 0 && <SplitLayout main={<Section title="Transcrição" variant="panel">
        <Textarea aria-label="Transcrição de origem" value={item.transcript} readOnly rows={22} />
      </Section>} aside={sourcePanel} asideLabel="Contexto da fonte" />}

      {step === 1 && <RichTextEditor title={item.title} text={item.article} document={item.articleDocument}
        onTitleChange={(title) => editArticle({ title })}
        onChange={({ document, text }) => editArticle({ articleDocument: document, article: text })}
        source={{ transcript: item.transcript, name: item.source, participants: item.participants, context: item.context }}
        versions={item.articleVersions ?? []} onVersionsChange={(articleVersions) => update(item.id, { articleVersions })}
        focused={focusMode} onFocusChange={setFocusMode} />}

      {step === 2 && currentSlide && <ResizablePanels defaultSize={520} min={280} max={600} collapsible={false}
        label="Redimensionar editor e prévia" left={<PageStack>
        <Section title="Textos do carrossel" meta={`${item.slides.length} slides`} variant="panel">
          <PageStack>
            <Segmented label="Selecionar slide" value={slideIndex} onChange={setSlideIndex}
              options={item.slides.map((_, index) => ({ value: String(index), label: `Slide ${index + 1}` }))} />
            <Field label="Título do slide" required>{({ id }) => <Input id={id} maxLength={100}
              value={currentSlide.title} onChange={(event) => editSlide("title", event.target.value)} />}</Field>
            <Field label="Texto do slide" required>{({ id }) => <Textarea id={id} rows={7} maxLength={280}
              value={currentSlide.body} onChange={(event) => editSlide("body", event.target.value)} />}</Field>
          </PageStack>
        </Section>
        <Section title="Sequência de leitura" variant="panel">
          <List label="Slides do carrossel">
            {item.slides.map((slide, index) => <ListItem key={index} title={slide.title || "Título a definir"}
              meta={`Slide ${index + 1}`} description={index === 0 ? "Capa" : index === item.slides.length - 1 ? "Encerramento" : "Desenvolvimento"}
              selected={Number(slideIndex) === index} onClick={() => setSlideIndex(String(index))} />)}
          </List>
        </Section>
      </PageStack>} right={<PageStack>
        <Section title="Prévia do slide" meta={`${Number(slideIndex) + 1} / ${item.slides.length}`} variant="panel">
          <MediaFrame ratio="4/5" alt={`Prévia do slide ${Number(slideIndex) + 1}`} caption="Template editorial · demonstração">
            <FixedFrame mainLabel="Conteúdo do slide" header={<MetaList size="xs" items={["Content Ventures", `${Number(slideIndex) + 1} / ${item.slides.length}`]} />}
              footer={<MetaList size="xs" items={["Conversas que viram conteúdo", "→"]} />}>
              <CardHeader title={currentSlide.title} titleAs="h2" size="md" />
              <Section>{currentSlide.body}</Section>
            </FixedFrame>
          </MediaFrame>
        </Section>
        <DescriptionList label="Origem do carrossel" labelWidth={85} items={[
          { label: "Base", value: "Artigo aprovado" }, { label: "Formato", value: "Vertical · 4:5" },
        ]} />
      </PageStack>} />}

      {step === 3 && <SplitLayout main={<PageStack>
        <Section title="Entrega pronta" meta={<Badge tone="teal" variant="text">Revisada e aprovada</Badge>} variant="panel">
          <List label="Arquivos da produção" framed={false}>
            <ListItem title="Artigo formatado" description={`${item.title} · HTML`}
              actions={<Button icon={Download} onClick={() => downloadArticle(item.title, item.article, item.articleDocument)}>Baixar artigo</Button>} />
            <ListItem title="Texto do artigo" description="Versão sem formatação · TXT"
              actions={<Button icon={Download} onClick={() => downloadText("artigo.txt", `${item.title}\n\n${item.article}\n\nFonte: ${item.source}`)}>Baixar texto</Button>} />
            <ListItem title="Textos do carrossel" description={`${item.slides.length} slides · TXT`}
              actions={<Button icon={Download} onClick={() => downloadText("carrossel.txt", item.slides.map((slide, index) => `Slide ${index + 1}\n${slide.title}\n${slide.body}`).join("\n\n"))}>Baixar textos</Button>} />
          </List>
        </Section>
        <Section title="Aprovações"><DescriptionList label="Revisões concluídas" layout="grid" items={[
          { label: "Artigo", value: <Badge tone="teal" variant="text">Aprovado</Badge> },
          { label: "Carrossel", value: <Badge tone="teal" variant="text">Aprovado</Badge> },
        ]} /></Section>
      </PageStack>} aside={sourcePanel} asideLabel="Rastreabilidade da entrega" />}

      {step !== 1 && <ActionBar position="static" start={<Button variant="ghost" icon={ArrowLeft}
        onClick={() => step === 0 ? router.push("/productions") : navigateStep(step - 1)}>Voltar</Button>}>
        {step === 0 && <Button variant="primary" trailingIcon={ArrowRight} onClick={() => {
          if (item.stage === "source") update(item.id, { stage: "article" }); navigateStep(1);
        }}>Continuar para artigo</Button>}
        {step === 2 && <Button variant="primary" icon={Check}
          disabled={item.slides.some((slide) => !slide.title.trim() || !slide.body.trim())}
          onClick={() => { update(item.id, { carouselApproved: true, stage: "ready" }); navigateStep(3); toast("Carrossel aprovado", { tone: "success" }); }}>
          Aprovar carrossel
        </Button>}
        {step === 3 && <Button variant="primary" onClick={() => router.push("/productions")}>Concluir produção</Button>}
      </ActionBar>}
    </PageStack>
  </ReporterShell>;
}
