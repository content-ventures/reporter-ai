# Reporter IA

Produto da Content Ventures para automatizar fluxos de produção editorial.

This repository contains the R0 foundation and an interactive R1 interface preview: transcription → article → approval → carousel → export.

The preview uses fictional content and in-memory React state. Reloading the page resets edits and new productions. Text files are read locally; article generation and carousel composition are demonstrations. Articles can be downloaded as formatted HTML or plain TXT; slide copy is exported as TXT. No backend, database, authentication, or external AI service is connected.

The writing studio in `src/components/editor/` uses Tiptap 3 with Design System V3 controls and tokens. It combines a navigable block outline with Design System reordering, contextual selection actions, a writing assistant, searchable source excerpts and session versions. Blocks can be inserted, reordered, duplicated and deleted; rich formatting, images, reading preview, focus mode and HTML export remain available.

Assistant responses are explicitly labeled local simulations. Presets and prompt intent choose deterministic example transformations; no AI model is called. Suggestions are editable, can replace the target or be inserted as a new block, and are rejected if the document changed after generation. Applying a suggestion or restoring a version records a snapshot first. Structured content and snapshots survive navigation within the current session; edits invalidate downstream approvals. Local images stay in memory and are embedded in the HTML export. The studio composes public Design System components for its layout, controls, lists and menus. Document node views also compose public DS components. There is no local editor stylesheet; only user-authored document formatting is passed through from Tiptap.

## Stack

- Next.js 16 com App Router;
- React 19;
- TypeScript;
- pnpm 10;
- Node.js 20.9 ou superior;
- Design System oficial `@content-ventures/design-system`, consumido por `@content-ventures/design-system/v3`.

## Pré-requisitos

O Design System é instalado diretamente do repositório oficial em um commit fixado no lockfile. Nenhuma credencial adicional é necessária.

## Desenvolvimento local

```bash
corepack enable
pnpm install
pnpm dev
```

A aplicação estará disponível em [http://localhost:3000](http://localhost:3000).

O histórico e a política de versões ficam em [http://localhost:3000/versions](http://localhost:3000/versions).

## Verificação

```bash
pnpm gate
```

Esse comando executa as políticas do repositório, lint, verificação de tipos, testes e build de produção. O `pnpm install` ativa os hooks versionados automaticamente.

As regras de branches, commits médios, PRs, Design System, releases e deploys estão em [docs/DEVELOPMENT_HARNESS.md](docs/DEVELOPMENT_HARNESS.md).

## Design System

- Use somente a API pública `@content-ventures/design-system/v3` e seus subpaths documentados.
- Procure um componente no Design System antes de criar qualquer elemento visual.
- Não copie componentes, tokens, fontes, ícones ou CSS do Design System para este repositório.
