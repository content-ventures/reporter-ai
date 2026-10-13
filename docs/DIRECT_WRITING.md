# Direct article writing

The user requested an additional way to open a text editor and write from scratch. The
home page offers “Escrever do zero” alongside the original “Nova produção” action.

An editor or admin clicks once to create an owned article titled “Artigo sem título”. The
existing article studio opens with an empty title and document, focuses the first paragraph
and shows “Comece a escrever…”. Its formatting, image tools, autosave, version history,
approval and delivery continue to use the existing R1 implementation. Writing a title and
text, reloading and using “Continuar” on the home page reopen that same draft.

The addition is frontend-only, using the current local adapter and browser persistence.
`ProductionCommands.createBlank` atomically creates a production and article draft without
a fabricated transcript, source authorization, AI generation or immutable version. Invalid
input and users without an editor/admin role leave the workspace unchanged. The entry button
stays busy until navigation, preventing repeated clicks from creating duplicate drafts.

`writing-article` is an additional R1 flow: Artigo → Aprovação → Entrega. It starts directly
in the existing article stage and reuses the existing gate and export checks. The original
`transcript-article` flow, transcript creation, source authorization, article generation,
carousel, approvals and delivery remain available. No original R1 file or feature is removed.
AI drafting continues to require real authorized source material; direct writing does not
invent material to bypass that requirement. Human-authored previews do not carry the
“Simulação local” label used for AI output.

Contract checks cover blank creation, atomic refusal and role enforcement, autosave,
versioning, approval and export readiness without material. The existing route smoke adds
the direct-writing journey at 1440 and 390 px, covering initial editor focus, title/text
editing, browser reload, home continuation and absence of console errors or page overflow.

October 9 verification: `pnpm gate` passed (1,106 tests and production build), and all ten
selected route/flow checks passed across desktop and phone, including direct writing and
original R1 continuation/restricted access.
