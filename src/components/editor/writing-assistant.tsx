"use client";

import { useState } from "react";
import {
  Button, CardHeader, Disclosure, ExpandableText, Field, FieldGroup, IconButton, List, ListItem,
  MetaList, PageStack, Panel, SearchField, Section, Segmented, Select, Textarea,
} from "@content-ventures/design-system/v3";
import { ArrowRight, Check, Clock, FileText, LayoutList, PenLine, Plus, RotateCcw, Send, Sparkles, X } from "@content-ventures/design-system/v3/icons";
import type { ArticleVersion } from "./article-document";
import type { Intent, Suggestion } from "./studio-model";

export type SourceInfo = { transcript: string; name: string; participants: string; context: string };
export type AssistantTab = "ai" | "source" | "history";
type Props = {
  tab: AssistantTab; onTab: (tab: AssistantTab) => void; onClose: () => void;
  selectedText: string; selectedLabel: string; tone: string; onTone: (tone: string) => void;
  suggestion: Suggestion | null; stale: boolean; busy: boolean;
  onGenerate: (intent: Intent, prompt?: string) => void;
  onEditSuggestion: (result: string) => void; onApply: (mode: "replace" | "insert") => void; onDiscard: () => void;
  source: SourceInfo; onQuote: (text: string) => void;
  versions: ArticleVersion[]; onSave: () => void; onRestore: (version: ArticleVersion) => void;
};

export function WritingAssistant(props: Props) {
  const [prompt, setPrompt] = useState("");
  const [sourceQuery, setSourceQuery] = useState("");
  const { tab, suggestion, source } = props;
  const excerpts = source.transcript.split(/\n\s*\n/).filter(Boolean);
  const filteredExcerpts = excerpts.filter((text) => text.toLocaleLowerCase().includes(sourceQuery.toLocaleLowerCase()));
  function submitPrompt() {
    if (!prompt.trim()) return;
    const request = prompt.trim().toLocaleLowerCase("pt-BR");
    const intent = /resum|encurt|reduz/.test(request) ? "shorten" : /lista|tópico/.test(request) ? "list" : /contin|expand/.test(request) ? "continue" : /rascunho|artigo completo/.test(request) ? "draft" : "rewrite";
    props.onGenerate(intent, prompt.trim());
  }
  return <PageStack aria-label="Painel editorial">
    <CardHeader title="Copiloto editorial" meta="Em contexto" actions={<IconButton label="Fechar painel editorial" icon={X} variant="ghost" size="sm" onClick={props.onClose} />} />
    <Segmented size="sm" full label="Painel editorial" value={tab} onChange={props.onTab} options={[
      { value: "ai", label: "Assistente", icon: Sparkles }, { value: "source", label: "Fonte", icon: FileText }, { value: "history", label: "Versões", icon: Clock },
    ]} />
    {tab === "ai" && <Panel label="Assistente de escrita">
      <Section title={props.selectedLabel} titleAs="h3">
        <ExpandableText lines={2}>{props.selectedText || "Escolha um bloco ou selecione um trecho no artigo."}</ExpandableText>
      </Section>
      {!suggestion && !props.busy && <Section>
        <List label="Ações de escrita" framed={false} dividers={false}>
          <ListItem density="sm" leading={<PenLine size={16} />} title="Reescrever" onClick={() => props.onGenerate("rewrite")} />
          <ListItem density="sm" leading={<FileText size={16} />} title="Resumir" onClick={() => props.onGenerate("shorten")} />
          <ListItem density="sm" leading={<ArrowRight size={16} />} title="Continuar" onClick={() => props.onGenerate("continue")} />
          <ListItem density="sm" leading={<LayoutList size={16} />} title="Criar tópicos" onClick={() => props.onGenerate("list")} />
          <ListItem density="sm" leading={<Sparkles size={16} />} title="Criar rascunho" description="Usar a transcrição completa" onClick={() => props.onGenerate("draft")} />
        </List>
      </Section>}
      {props.busy && <Section title="Preparando sugestão…" titleAs="h3"><Button variant="ghost" size="sm" onClick={props.onDiscard}>Cancelar</Button></Section>}
      {suggestion && !props.busy ? <>
        <Section>
          <FieldGroup label={suggestion.label} columns={1} meta={<IconButton label="Gerar novamente" variant="ghost" size="sm" icon={RotateCcw} onClick={() => props.onGenerate(suggestion.intent, suggestion.prompt)} />}>
            {suggestion.prompt && <MetaList size="sm" items={[suggestion.prompt]} />}
            <Disclosure summary="Comparar com original"><ExpandableText lines={8}>{suggestion.original || "Artigo vazio"}</ExpandableText></Disclosure>
            <Field label="Sugestão editável" error={props.stale ? "O artigo mudou. Gere uma nova sugestão antes de aplicar." : undefined}>
              {({ id, describedBy }) => <Textarea id={id} aria-describedby={describedBy} aria-label="Texto sugerido" value={suggestion.result} rows={9} onChange={(event) => props.onEditSuggestion(event.target.value)} />}
            </Field>
            <Button variant="primary" size="sm" icon={Check} disabled={props.stale || !suggestion.result.trim()} onClick={() => props.onApply(suggestion.mode)}>{suggestion.mode === "insert" ? "Inserir no artigo" : "Aplicar sugestão"}</Button>
            {suggestion.mode === "replace" && <Button variant="ghost" size="sm" icon={Plus} disabled={props.stale || !suggestion.result.trim()} onClick={() => props.onApply("insert")}>Inserir como novo bloco</Button>}
            <Button variant="ghost" size="sm" onClick={props.onDiscard}>Descartar</Button>
          </FieldGroup>
        </Section>
      </> : !props.busy && <Section>
        <FieldGroup label="Pedir à IA" columns={1}>
          <Field label="Tom de voz">{({ id }) => <Select id={id} size="sm" label="Tom de voz" value={props.tone} onChange={props.onTone} options={["Jornalístico", "Didático"].map((label) => ({ value: label, label }))} />}</Field>
          <Textarea rows={3} aria-label="Instrução para o assistente" placeholder="Ex.: deixe este trecho mais objetivo…" value={prompt} onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); submitPrompt(); } }} />
          <Button size="sm" variant="primary" icon={Send} disabled={!prompt.trim()} onClick={submitPrompt}>Gerar sugestão</Button>
        </FieldGroup>
      </Section>}
    </Panel>}
    {tab === "source" && <Panel label="Material de origem">
      <Section>
        <FieldGroup label={source.name || "Transcrição"} columns={1}>
          <MetaList size="sm" items={[source.participants, source.context]} />
          <SearchField label="Buscar na transcrição" placeholder="Buscar na transcrição…" value={sourceQuery} onValueChange={setSourceQuery} size="sm" />
        </FieldGroup>
      </Section>
      {filteredExcerpts.map((text, index) => <Section key={`${index}-${text.slice(0, 30)}`}>
        <ExpandableText lines={6}>{text}</ExpandableText>
        <Button variant="ghost" size="sm" icon={Plus} onClick={() => props.onQuote(text.replace(/^[^:\n]{1,40}:\s*/, ""))}>Inserir citação</Button>
      </Section>)}
      {!filteredExcerpts.length && <Section><MetaList items={["Nenhum trecho encontrado"]} /></Section>}
    </Panel>}
    {tab === "history" && <Panel label="Versões do artigo">
      <Section><Button icon={Plus} size="sm" onClick={props.onSave}>Salvar versão atual</Button></Section>
      {props.versions.slice().reverse().map((version) => <Section key={version.id} title={version.label} titleAs="h3" meta={version.time}>
        <MetaList size="sm" items={[version.title]} />
        <Disclosure summary="Ver conteúdo"><ExpandableText lines={9}>{version.text || "Artigo vazio"}</ExpandableText></Disclosure>
        <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => props.onRestore(version)}>Restaurar versão</Button>
      </Section>)}
    </Panel>}
    <MetaList size="xs" items={[tab === "history" ? "Versões disponíveis durante esta sessão" : "Artigo e fonte conectados nesta produção"]} />
  </PageStack>;
}
