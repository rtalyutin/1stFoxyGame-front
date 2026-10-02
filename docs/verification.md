# R1 behavior verification

**Verdict: PASS for the local R1 behavior scope below.** Verified on 2026-10-02 by a verifier separate from the implementation author. This is not a deployment approval or a claim of native Android acceptance.

## Object and environment

- Frontend served by Vite from the frozen source revision; real local backend health endpoint.
- Node.js 24.19.0; Playwright 1.56.1; Chromium 141.0.7390.37, headless with SwiftShader.
- Desktop: 1280×800 behavior checks and 1440×900 screenshots, DPR 1. Portrait touch emulation: 390×844, DPR 1 and 3.
- Exact runtime/config manifest SHA-256: `6d0ce2051001e876b72295f485a0170e725307627e9c0c39f459dffe707d3e6b`. The manifest contains the 12 files listed below, sorted by relative path, each encoded as `SHA256  relative/path` followed by LF. It excludes tests, generated artifacts, documentation and CI files. Runtime files were unchanged at the final verification boundary.

## Executed checks

| Scope | Actual result |
| --- | --- |
| Project tests | Frontend: 26/26 passed. Backend: 6/6 passed, including OpenAPI validation and planned-operation schemas. |
| Independent simulation scenarios | 10/10 passed: automatic advance, lateral bounds, pause freeze, identical seeded command replay at 30/60 rendering schedules, swept collision, manual miss, first-target stop, safe captured body, return-path immunity, equal-time hit priority, earlier terminal death, rear breach, cooldown/return gating and immutable cast settings. Several scenarios cover multiple related assertions. |
| Independent browser scenarios | 11/11 passed after correcting two test-fixture errors. Desktop holding the mouse for 5 seconds produced one cast; a fresh click produced the next. UI pause/resume did not attack. Opposing movement keys cancelled. Real CDP touch events supported simultaneous movement/aim and one cast on aim-finger release. |
| Lifecycle and network | Running and countdown network loss paused the run; reconnection required explicit resume. A delayed health response could not override a blur-cancelled start. Pending touch cancellation and stale release did not cast or start cooldown. Pointer cancellation was safe. Natural defeat froze simulation; retry used a different run ID. |
| Visibility and graphics | Synthetic `document.hidden`/`visibilitychange` and blur events verified their handlers. Actual `WEBGL_lose_context.loseContext()` paused and froze the run; `restoreContext()` restored rendering readiness while the run remained paused. No page errors occurred in the passing browser scenarios. |
| DPR 3 | Render target was 643×1392. Three aim/projection round trips had maximum error 0.272 CSS pixels. The hero was inside the portrait viewport. |
| Production bundle smoke | A fresh `npm run build` was served as static `dist` files with a local API proxy. The 3D scene rendered, the run reached `RUNNING`, distance advanced and one mouse click produced `Крюк летит`. Bundled default/color shader chunks loaded successfully. Zero page errors, console errors or failed requests. Screenshot inspected. |
| Actual HTTP | Five requests verified health/healthz 200 with fresh timestamps and `no-store`, unavailable profile/registration 404, and malformed JSON 400 with the bounded error envelope. |
| Negative test sensitivity | In an isolated copy, lowering hook-hit priority below contact caused three of 21 combat tests to fail, exit code 1. The original implementation was not mutated. |

## Fixed defect and limitations

The verifier reproduced a blocking browser defect: storing native `fetch` as an object method caused `Illegal invocation`, so a healthy backend appeared offline. The default request wrapper was corrected. The same browser probe then returned a successful health check, and desktop/portrait runs started normally.

Two initial browser failures were test-fixture errors, not accepted product defects: the movement measurement included sequential key-transition ticks, and the CDP touch-end fixture released the movement finger instead of the aiming finger. Event traces identified both; corrected checks passed. A DPR observer also needed the actual versioned Vite module URL; its final probe passed.

This verification does not establish performance or ergonomics on physical Android hardware, packaged Android/desktop apps, production-host TLS/rollback, or final art quality. Graphics use temporary models. Detailed behavior checks ran against Vite-served source; a separate production-bundle smoke also passed. CI/container results are recorded separately by the release workflow and are not inferred here.

## Production bundle identity

The smoke used a fresh Vite production build of the same unchanged runtime source, Chromium 141.0.7390.37 at 1280×800, DPR 1. Its 80-file `dist` manifest SHA-256 is `2806a49a148b90c6649b1728bc3bccc258de5b54d9c75c8872022cd698bffdfe`, calculated with the same sorted path/hash/LF format as the runtime manifest, including source maps. Main entry: `assets/index-UVZGJ_Ma.js`. This confirms local bundle/shader behavior; it does not claim a hosted production deployment.

## Runtime manifest

```text
d14b96882b70d038c6e39f7b3b277e0331d5b85d89442dca8ad0528dac65cc2a  index.html
1619d026b80548a8663a5cb3f8c83d68287a8f9c2fc6003e66cc1c7705a98c6e  package-lock.json
f8efe1732bd535f249ebbe51eb85e074d09a36372e3adb98a0b704eff70a5a81  package.json
ba2be96968acdd69ca163683f8faf3fc2a71364388c3b580e3cf9ad72c1fdd2d  src/game/config.ts
fd1b8d14a8752f9cfaf984d3cf827ca1dccc20569ff0ee9c481b65ab1d96e348  src/game/simulation.ts
0c31c9ac3d6e7be1fb32f934dcaef88e5fc535778aed01c4c4aa755bfc8e3258  src/main.ts
7823d9b9a46e3d57e91453c4889a0794891543be0aed0977ad56a5b9f6bc012e  src/platform/connection.ts
3c123cf07f6f0b39da0d86c2654cc109e98d595dcb0bc3c6015225401b0db406  src/platform/input.ts
26c2c09c4faeee89f7921b4edc1cea6f487fefa616e1dab3731ff0c656b4ee73  src/presentation/world.ts
f045c38401b59c0b8f02569fb5a1f0149a5cad53c2c60edf8f8f6149ef2a3d57  src/style.css
8f2537f9a6e27bbd339b8f2f33f3cbeaa3272a73985fbc059163a192d004d98c  tsconfig.json
70f3b9d5e1e4af04aab54fc8ebcf6e6b089d78ee1f2b513860618fb38b111308  vite.config.ts
```
