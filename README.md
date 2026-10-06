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

O Design System é instalado a partir de um repositório privado. Antes da instalação, confirme que a chave SSH ativa tem acesso à organização no GitHub:

```bash
ssh -T git@github.com
```

Se a chave estiver registrada com um alias no `~/.ssh/config`, carregue-a no agente SSH ou associe a identidade ao host `github.com` antes de executar o `pnpm install`.

## Desenvolvimento local

```bash
corepack enable
pnpm install
pnpm dev
```

A aplicação estará disponível em [http://localhost:3000](http://localhost:3000).

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
