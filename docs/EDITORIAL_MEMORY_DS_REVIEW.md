# Editorial memory Design System dependency review

Publication update (October 29, 2026): João explicitly approved the DS-only publication. [PR #7](https://github.com/content-ventures/design-system/pull/7) passed CI and was merged by rebase by `fagundesjv`. Annotated tag `v0.4.1` points to `ccc227c0e42af226cd133425d2b61765d09edd8c`; tag object `575ae8dbd8f9ab30e821b2d81667d564a02b9357` uses the verified numeric GitHub noreply identity. The merged tree is identical to candidate `fea2b4f`, and main CI also passed. Reporter dependency installation now resolves the published 0.4.1 package; its local pin/clean acceptance is being verified. No Reporter publication or deployment is authorized by this approval.

The review below records the original candidate and preview evidence before publication.

The candidate fixes the shared components behind the Flow 4 import and immutable article readers. Reporter still pins Design System 0.4.0 at `0479b31c567653c76b93ec2ec89eb6976ce31172`. The local overlay is a preview, not clean-install or CI acceptance.

## Reviewable source

- Repository: `content-ventures/design-system`.
- Isolated checkout: `/private/tmp/reporter-memory-design-system`; the primary Design System checkout is unchanged.
- Branch: `codex/modal-select-entry`.
- Base: `08887438caab11b8cde59332f47773e53bdcedb0`, whose tree matches Reporter's existing dependency pin.
- Candidate: `fea2b4fbd0eaf2a227d302155547025edfe1bfa4`, with package version 0.4.1.
- Complete patch: `/private/tmp/reporter-memory-design-system-review.patch`.
- Authenticated local author: `fagundesjv`, `269704659+fagundesjv@users.noreply.github.com`.

## Resulting behavior

1. Shared Select panels in native dialogs use the manual-popover top layer when available. Viewport positioning follows finite entry animations, and a sheet's temporarily offscreen keyboard anchor remains usable while entering. Native modal boundaries stop inappropriate clipping by higher ancestors; contained-layer clipping and the existing unsupported-browser/nonmodal fallback remain intact.
2. Modal layers ignore obsolete or nested native close events and retain the current Tab/Shift+Tab focus boundary.
3. Sidebar identity/navigation/footer have one named complementary landmark, identity text keeps word boundaries, existing foreground tokens provide readable search/profile text, and toast announcements have a valid named live-region role.
4. Immutable ProseMirror readers expose the shared visible keyboard focus ring. Reporter separately supplies their accessible name and focusability. No public export or component API is removed.

## Validation and scope

`pnpm check` passes lint, types, all 380 DS tests and the production build (`/tmp/reporter-memory-ds-reader-check.log`). The native responsive-dialog and read-only text catalog cases pass at 1440×900 and 390×844, in light/dark themes, including keyboard selection, both Escape boundaries, focus return, a real two-pixel reader outline, no sideways page scroll and no page errors (`/tmp/reporter-memory-ds-final-browser.json`). Sidebar component Axe checks previously passed all four width/theme combinations; those component files have not changed since that verification. `21st review` is unavailable in this environment (127).

Reporter product source `205b6b3` passes the preview gate/build with all 1,870 tests (`/tmp/reporter-memory-a11y-final-preview-gate.log`). The subsequent test-only `5ababbe` and `8a6da46` preserve every Axe rule/result, measure actual tab colors and capture native input targets. The complete final desktop/phone journeys pass (`/tmp/reporter-memory-a11y-native-events-ui-1440.log`, `/tmp/reporter-memory-a11y-native-region-ui-390.log`), including twelve input cycles per width, actual desktop pointer/keyboard and mobile keyboard entry overlap, native mobile touch, reduced motion, focus/visible outline, real extraction announcements, exact article approval/download/history, corrections, replacements, feedback, policy recovery and collection URL conflicts. All 32 captured bank states per width have zero Axe violations; retained tab pseudo-element contrast reviews are supplemented by measured ratios of at least 4.906887995703311:1. Mobile touches use normal actionability; no early-touch claim is made. Regression smoke on the same build passes 94 tests with one existing skip (`/tmp/reporter-memory-a11y-final-preview-smoke.log`).

The automated scans are local Chromium checks with synthetic inputs/providers and test authentication. They do not prove manual screen-reader/editorial acceptance, representative factual quality, Safari/Firefox behavior or controlled production readiness. Original-file/batch storage and UI, real archive acceptance and operational release work remain open.

## Exact remote actions requiring approval

The [mandatory development harness](DEVELOPMENT_HARNESS.md#pull-requests) requires explicit approval for each remote action. The proposed authorization covers only pushing this DS branch, opening one review PR, merging it with rebase after its checks pass, and publishing the annotated `v0.4.1` tag at the merged commit. Read-only GitHub verification found the base unchanged and that tag absent. Recheck both immediately before any approved action.

After publication, update the Reporter dependency SHA and lockfile locally, retire the overlay, and repeat frozen installation, gate/build, whole desktop/phone journeys and smoke against the published package. Commit the dependency files alone as `build(deps): pin design system v0.4.1`. Reporter push/PR/merge, Preview, staging, deployment, remote database writes and further paid provider calls require their own authorization.
