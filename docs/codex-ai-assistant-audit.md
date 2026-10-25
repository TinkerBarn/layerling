# Layerling Codex assistant: compatibility and quality audit

Audit date: 2026-10-25. Branch: `feature/codex-ai-assistant`.

This report separates code and automated-test evidence from environments that were unavailable. “Passed” means the named test actually ran; it does not mean the feature is certified on every operating system or browser.

## Code compatibility and regression scope

The reviewed integration touches the local assistant component and API, the existing Layerling MCP stdio server, workspace settings, shared styles, and message catalogues. No package dependency or build-system change was made for this work. Existing CAD operation implementations and MCP tool names/schemas were retained. The assistant requests the existing `layerling-mcp-server.mjs` tools rather than adding a second CAD command path.

Fixes in this audit include per-tab Codex conversation/event ownership, backend guards before process start and CAD turns, a runtime check for the required Layerling tools, loopback binding and Host-header validation, development frame-embedding protection, strict ownership checks and random one-time nonces for approval responses, resumed-thread ownership, protection against parallel app-server starts, Codex executable discovery on PATH (including Windows command wrappers), MCP handshake version negotiation, missing translations, and regenerated graphite theme styles.

## Operating system and browser compatibility

The repository documents a Windows quick start and Docker use on macOS/Linux, but does not define a complete browser support matrix. That does not imply that the local Codex integration is supported on each of those platforms. It requires Node.js `>=22.18`, a local Codex CLI and a Layerling development server. Only the pre-existing manual macOS/Codex CLI `0.163.0` integration result is recorded; it was not repeated as part of this audit.

| Layerling host | Browser | Codex integration result | Notes |
| --- | --- | --- | --- |
| macOS | Browser unspecified in existing manual note | Existing manual smoke test recorded; not repeated | CLI `0.163.0`; not a broad browser test |
| Windows | Any | Not tested | CLI path/PATHEXT handling is implemented, not validated on Windows |
| Linux | Any | Not tested | Local Codex CLI and browser were not available for validation |
| Any | Chrome / Edge | Not tested for assistant UI | The main README documents these browsers for certain other file/font features; that is not an assistant compatibility result |
| Any | Firefox / Safari | Not tested for assistant UI | Speech input additionally depends on browser Web Speech API support |

No real-browser visual/layout, zoom, keyboard/mouse, resize, speech, authentication, or browser-switch test was run in this audit. The 522 CAD E2E tests below exercise editor behavior in the repository test harness, not desktop browser integration.

## MCP and feature detection

The existing stdio MCP transport and tool catalogue remain the shared implementation. The server now negotiates one of the handshake versions it implements rather than echoing an arbitrary client version. Focused tests cover the negotiated versions, unknown/future-version fallback, unique tool names, and tool schemas. Before a turn is sent, the Codex App Server must report the Layerling server and the editor-list, scene-read, shape-create, and object-update tools. Missing tools stop the request with a diagnostic.

The assistant icon is offered only when the user enabled it in workspace settings, a local editor is visible to the local MCP bridge, and a Codex executable is found. Status, login, logout, and send endpoints independently check for a reachable bridge and editor before starting Codex. UI visibility is not used as backend authorization. The local MCP tool that opens a new editor is disabled for this assistant so a chat request cannot spawn a second Layerling window. Local mesh export and project-save tools are hidden and rejected in assistant mode; standard MCP clients retain them.

Automated validation does not include a live Codex App Server + editor end-to-end run in this audit; no Layerling editor was listening on the default ports during the run. Runtime tool detection is covered by unit tests, but compatibility with every Codex CLI release remains unverified.

## Localization and UI

Layerling has 18 message catalogues: Arabic, Czech, Danish, Dutch, English, French, German, Hungarian, Italian, Japanese, Polish, Brazilian Portuguese, Russian, Slovenian, Spanish, Turkish, Simplified Chinese, and Traditional Chinese. All 60 `codexAssistant.*` message keys are present in each catalogue. The new workspace setting label is translated in all 18 catalogues. Translation placeholders and complete-language key parity pass their focused tests.

The repository’s overall translation status is not complete for every language; this assistant work does not claim otherwise. No visual layout pass was run for translated text lengths, narrow windows, zoom levels, or right-to-left Arabic. The graphite theme CSS was regenerated and its consistency test passes.

## Documentation

Updated [codex-ai-assistant.md](codex-ai-assistant.md) with setup, use, model/effort picker, browser dictation limitations, MCP feature detection, per-tab conversations, logout scope, troubleshooting, and platform limits. This guide is German; the broader project does not have this standalone assistant guide in all 18 languages. In-product text is translated in all 18 message catalogues.

## Test results

| Check | Result |
| --- | --- |
| TypeScript typecheck | Passed (`npm run typecheck`) |
| Focused MCP, localization, and graphite tests | Passed, 85/85; security-focused follow-up set passed 21/21 |
| Existing Layerling CAD E2E suite | Passed, 522/522 across 57 files |
| Full unit suite, normal environment | 3,203 passed, 12 failed; failures included environment-dependent storage/path tests and missing new translations |
| Full unit suite after fixes (`NODE_OPTIONS=--localstorage-file=/tmp/layerling-test-localstorage.json TMPDIR=/tmp npm test`) | Passed, 3,222/3,222 across 387 files |
| Production build (`npm run build`) | Passed |
| Offline dependency audit (`npm audit --offline`) | 0 findings in the local cache; current registry advisories could not be refreshed (`ENOTFOUND registry.npmjs.org`) |
| `git diff --check` | Passed |
| Cross-platform/browser/manual visual integration | Not tested |

The initial unit run exposed a macOS `/tmp` versus `/private/tmp` mismatch in Shared Projects response paths. `folderKey` now compares canonical paths, preserving its existing containment checks. The focused Shared Projects tests and final full suite pass.

## Security audit

The independent audit used **GPT-6 Astra, Reasoning Medium**. It reviewed the assistant API, local request gate, app-server process, approval handling, MCP tools, browser storage/rendering, related filesystem behavior, and dependency changes.

| Severity | Finding | Resolution |
| --- | --- | --- |
| High | Dev server listened on all interfaces by default; a remote peer could spoof loopback host headers and reach the local Codex account. | `npm run dev` now binds `localhost`; request validation also checks the actual Host header. An actual socket-level attack test was blocked by sandbox `EPERM`. |
| Medium | Next.js can normalize request URLs, hiding a hostile Host header. | Host-header validation and a regression test reject the hostile authority. |
| Medium | Reused numeric app-server IDs could let stale approval cards answer a later request. | Each request now has a random one-time nonce, session/method binding, and pending approval cleanup on child exit. Independent mock-process checks rejected stale nonce, wrong session, and replay. |
| Medium | MCP mesh export and project save could write to arbitrary local paths outside Codex’s file sandbox. | These tools are omitted and rejected in assistant mode; the ordinary MCP catalogue keeps them. The reviewer verified behavior with the stdio server. |
| Medium | Clickjacking could expose approval cards in an embedded page. | Development HTML routes now return `X-Frame-Options: DENY` and `Content-Security-Policy: frame-ancestors 'none'`; static export is unchanged. Configuration/build check passed; live browser verification was unavailable. |

The independent reviewer also checked parallel process starts (one child, requests wait for initialization), the nonce logic, file-tool gating, message rendering, and the path-normalization correction. It reported no HTML/eval sink in the assistant and no changed dependencies. `npm audit --offline` found no issues in its local cache; a live advisory refresh failed because `registry.npmjs.org` DNS was unavailable. No current-CVE conclusion is claimed.

Remaining security limits: loopback is not authentication between local processes or OS users; the computer and local Codex account are trusted. Windows behavior and real-browser attacks were not exercised. A deliberately network-exposed dev server is outside the supported assistant configuration. Persistent tool approval writes to the shared Codex configuration and is not scoped to this chat.

## Agents

- `layerling_arch`: inspected MCP and architecture interactions; localized 59 assistant strings in seven catalogues.
- `codex_docs`: inspected setup/documentation; localized the same assistant strings in seven catalogues.
- `security_audit`: independent security review and retest, GPT-6 Astra, Reasoning Medium.

The localization agents’ model metadata was not reported in their results, so this document does not infer it. Their changes were checked by the 18-catalogue key/placeholder comparison and i18n tests.
