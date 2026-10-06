# Reporter IA

Produto da Content Ventures para automatizar fluxos de produção editorial.

Este repositório contém a fundação técnica da R0. O primeiro fluxo editorial — transcrição → artigo → aprovação → carrossel — começa na R1 e ainda não faz parte desta entrega.

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
