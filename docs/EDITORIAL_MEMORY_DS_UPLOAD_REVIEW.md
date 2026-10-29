# Original-file control accessibility review

Publication update (October 29, 2026): João explicitly approved this DS-only publication. [PR #8](https://github.com/content-ventures/design-system/pull/8) passed CI and was merged by rebase by `fagundesjv`. Annotated tag `v0.4.2` points to `d7410a5fb3ebd7dec622395b2ce72faeaa0d1886`; tag object `6991962686f6e8869a427257ea13f8339782e4e0` uses the verified numeric GitHub noreply identity. The merged tree matches candidate `f678bb3`; main CI passed. Reporter now installs the official 0.4.2 package, with a passing frozen install and matching component source. Its final local pin/QA is in progress. The candidate review below preserves the prepublication state.

The first published dependency, DS v0.4.1, is complete: [PR #7](https://github.com/content-ventures/design-system/pull/7), rebase commit `ccc227c0e42af226cd133425d2b61765d09edd8c`, annotated tag `v0.4.1`, passing PR and main CI. The new Flow 4 file form then exercised two unchanged controls that were outside that original patch: inactive Segmented text fails contrast at 4.18:1, and Dropzone nests its native input inside another interactive control. Both failures remain recorded; no Axe rule is disabled.

## Reviewable candidate

- Repository: `content-ventures/design-system`; isolated checkout `/private/tmp/reporter-memory-design-system`.
- Base: `ccc227c0e42af226cd133425d2b61765d09edd8c`.
- Branch: `codex/accessible-upload-choices`.
- Candidate: `f678bb32be2d473d63974252bf3005064d5a69dc`; package version 0.4.2.
- Patch: `/tmp/reporter-memory-design-system-v0.4.2-review.patch`; durable copy `.reporter-local/editorial-memory/design-system-v0.4.2.patch`.
- Author/committer: `fagundesjv`, `269704659+fagundesjv@users.noreply.github.com`.

Dropzone now owns a hidden native file input beside its focusable button. Its public API, pointer/Enter/Space activation, file validation, disabled behavior and drag/drop contract are retained. Segmented uses the existing readable text token for inactive options. The Upload catalog includes an original-file example with TXT/CSV selection and the byte limit; no product CSS or substitute primitive is introduced.

## Verification

`pnpm check` passes lint, types, all 383 component tests and the production build (`/tmp/reporter-memory-ds-upload-final-check.log`). Three added regression cases cover the one-control accessibility invariant, real native-input activation through the public button, selection/drop validation and disabled refusal.

The catalog passes 1440/390 px and light/dark combinations with native keyboard file chooser activation, actual selected filenames, CSV format changes, retained focus, no nested interactive input, no horizontal page overflow and zero Axe violations in the complete picker specimen. Raw violations/incomplete results are retained without rule exclusions. All four captures were visually inspected (`/tmp/reporter-memory-ds-upload-{1440,390}-{light,dark}.png`, `/tmp/reporter-memory-ds-upload-browser.json`). A browser-test subscription race was corrected by registering the chooser event before the focus round trip; native input and original deadlines remain unchanged. `21st review` is unavailable (127).

Reporter uses its public RadioGroup for the form's two entry modes and public Dropzone/FileRow for file selection. The new DS candidate is previewed only through the harness-permitted component/font overlay. Reporter package/lock currently resolve published 0.4.1; integrated preview QA and subsequent frozen acceptance remain required. The candidate does not establish manual assisted-reading, real-corpus factual quality or production acceptance.

## Publication authorization

The [development harness](DEVELOPMENT_HARNESS.md#pull-requests) requires explicit approval for each remote action. The prior approval was limited to v0.4.1 and has been executed. The proposed new authorization covers only pushing this DS branch, opening one PR, merging by rebase after checks and publishing annotated tag `v0.4.2` on the merged commit. Recheck GitHub identity, base and tag immediately before acting. Reporter dependency updates remain local; no Reporter push/PR/merge, Preview, staging, deployment, remote database mutation or additional paid-provider call is included.
