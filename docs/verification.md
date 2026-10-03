# Behavior verification

## R2 local acceptance — 2026-10-03

Source: isolated R2 worktree based on remote R1 frontend `d9a9654ed743da5442a7265986c7cc287f586377`, backend `e1cb5fcac481b9a74c99f9d681c2e354d78548ee`. The 23-file source/config/test manifest SHA256 is `93c9daf84a81b16815e8bc3be89dd02784d3f668880a6096a4e7f1ecf3ccc17e`; checked paths and published backend revision are recorded in TASK_STATE.json. Historical R1 evidence below remains scoped to its own revision.

- Author checks: frontend typecheck/build, 55/55 tests with the real paired backend catalog; backend typecheck, 15/15 API/catalog/protocol tests and generated typed seed parity.
- Independent combat: 15 scenarios covering swept projectile hits/misses, source death, equal-time source kill plus bullet impact, three boss casts, one-hit normal/strong enemies, pause, deterministic replay, combined target deadlines, projectile reservation and reachable corridors. A 400-second synthetic stream test clears enemies artificially to inspect the generator; it is not a gameplay completion or balance result.
- Independent main UI: real local Fastify + Vite proxy on 1440×900, 390×844 and 320×740; desktop click, touch aim-release and cancellation, pause/explicit continuation, incompatible rule version rejection, no page errors or horizontal overflow.
- Independent WorldView: 1440×900, 390×844, 320×740 and 2560×1080; all three boss marks fit the viewport at the 36m spawn distance, actual casts change marks 3→2→1→0, only the final hit kills, pause freezes and clearing the scene removes threat objects.
- Independent actual main states: synthetic starting scenarios injected only into test responses, with production main-loop/DOM code; boss HUD 3→2→1→hidden, shot-warning bounds, projectile defeat text and revised gallery instruction verified at 1440×900 and 320×740. No test access is shipped.
- Independent internal RunLedger: owner isolation, three distinct boss hits, atomic rejection, surviving projectile terminal after source death, exact canonical retry and rejection of conflicting/reward/version/order/cooldown data.

QA found the battle HUD overlapping the defeat heading at 320×740 (QA-R2-01). The HUD is now hidden in GAME_OVER; a narrow repeat with an explicit visibility assertion and screenshot review passed. The independent verifier reran all 55 author tests with the real backend catalog; all listed source files matched the final manifest. Independent report SHA256: `ea24458e507070382c27d79c87f074ef0b5ed9f3e082b013c43122bc821160e9`.

These observations accept the local code/contract/UI scope. Backend PostgreSQL18.6 CI passed on [run37124551329](https://github.com/rtalyutin/1stFoxyGame-back/actions/runs/37124551329): 15 API/unit tests, 13 DB subtests (14 TAP tests including their parent), zero skips; real migration/constraint/version/concurrency/dump/restore checks and packaged migration CLI via URL and secret-file both passed. The first run exposed a test fixture expecting SQLSTATE23503 for DELETE RESTRICT; PostgreSQL correctly returned23001. Only the three fixture expectations and retained-row assertions were corrected; schema was unchanged. This backend workflow tested the PR merge revision832d0cb4171686fd4ec73ad712e448d3d747b3e3 containing head96df2a700c48ede89e3d65cd313b6dac8a2e4e6b. The exact pinned backend/frontend Docker pair still requires its separate frontend CI gate. Local Docker/PostgreSQL could not be run in this environment. Native Android, production deployment and player balance acceptance remain unverified. User-provided R1 HTTPS IP returned a certificate-name mismatch through the cloud browser, so production readback is not claimed.

## Historical R1 verification

The initial blockout report below is historical. The current GLB integration verification is recorded in the final section.

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

## GLB integration follow-up — current R1

**PASS for local model integration behavior**, independently verified on 2026-10-02 UTC. Final local source snapshot: `ab6c03c014433bbc655b77cd02624ad73394ef59`, clean before/after. Runtime content is identified by the manifest below; later documentation/publication does not alter it. QA used Chromium 141 / Playwright 1.56.1, WebGL2 SwiftShader, Node 24.19.0 and Babylon 9.29.0, at 1280×800 and 390×844. Real local backend health API was used.

| Scope | Observed result |
| --- | --- |
| Source assets | All ten GLB files are byte-identical to the uploaded Models v1 ZIP exports. Runtime import and original hashes are checked; source ZIP SHA256: `4f8903f79ae07610cf114938fd530757cc21f78539bfcc4e214c903fd56b08f5`. |
| Automatic checks | 32/32 tests across five files, strict typecheck and production build passed. |
| Browser checks | Ten scenarios on the corrected runtime plus four fresh final scenarios passed. Separate projection checks confirmed A/D and aim direction. |
| Event/animation adapter | Actual main loop recorded 62 steps and 62 observes, including 15 steps between renders. Run, strafes, cast, hold, both returns, hit/capture and terminal death were observed. |
| Real capture | Imported creep captured on tick 39/time 0.65; safe body returned through the hero and was removed on tick 66/time 1.10 with the run still active and kills=1. Real left/right pointer casts also captured their corresponding targets. |
| Attachments and pause | Chain follows the current animated hand; capture socket matches target hook socket within 1e-5. Actual pause freezes rig/socket/link positions, including side captures. |
| Disposal | Six UI restarts and 25 fixture replacements produced no node/rig/group growth after warmup: 710 meshes, 698 transform nodes, one skeleton, nine groups, 34 materials, zero enemies, nine sections and 220 links. |
| Model failure/retry | Injected tree HTTP503 with nine successful imports cleaned all model containers/rigs/groups/pools. Start stayed gated; retry imported ten models and reached RUNNING. |
| Context/death | Actual WebGL context loss/restore preserved the paused run and required explicit resume. Visual death completed without advancing terminal simulation/world state. |
| Production client | Unmodified built dist loaded ten GLB files and real API; portrait start/movement/pause and desktop resume/manual cast passed without page errors. Final screen copy was visible. |

The initial native right-handed scene reversed screen X for A/D. Independent QA reproduced D moving from CSS x640 to482.036, while simulation X increased. The presentation coordinate adapter was corrected; D then moved from x640 to774.269 and A moved back left. GLB files and gameplay rules were preserved. The earlier failure was retained as evidence, not counted as a pass.

Deterministic browser fixtures used the real simulation/GLB with temporary test-only module access injected through response routing; no test hook was added to the product. A separate slower-return fixture (15 m/s) exposed the late creep `death_capture` clip; the product return speed remains 45 m/s. One initial production check was a QA server setup failure (directory read instead of index.html); after correcting only the test server, the same production scenario passed.

Physical Android FPS, hardware GPU performance and physical two-finger ergonomics were not verified. Portrait emulation does not establish them. This local gate does not claim a Timeweb deployment, native wrapper, auth, shop or economy. The old blockout evidence does not establish final art performance.

Independent full report SHA256: `70910870caba3b62e9b707ecf8d9dbcb233177d3e2eadac0aac779eeafaf7f65`. The final local dist manifest digest was `b69a2b46fa298ec0cd9fefb70f61638405a3a6389a48730c988b6ee13c5f4ed0`; CI stamps its own source revision and archives its build separately.

### Current runtime/config/models identity

26 files, sorted relative paths, each line `SHA256  path` + LF; manifest SHA256 `a3b044f0951cb5a3ff8e006fb40ecafbf9e2f13a20225a6187ff861be4d1e08d`. Tests/docs/CI/deploy and generated dist are excluded. All 26 files independently matched and source/dist fingerprints remained unchanged at final verification.

```text
043626b8fa864a383c30d7efe3b7e05cc61cec0c1d788bb84642281541e56184  index.html
c949d7e6d6cd869c0cbab3227997604776e7d61e4e5670e2b766d5c0eb935858  package-lock.json
adf7eed4edb25820d14b87b07cd7cafc8ef444dd488cd2042d93adc28b46a7df  package.json
ead844de1665b1929215f9e9fc2c49cc417c5f26f921f36b8017f2d889adafd1  public/models/r1/bush.glb
25e8488e5ca5f487554691d42001be8cc6db4cf9a169c3e2d59a5ae29211a338  public/models/r1/chain.glb
a15659bc341564e74d40b987b28c5f4c112494cc9efddb1855db5335c5782794  public/models/r1/creep_basic.glb
dd91579e541fa51c47b6fb731394946e90a1574de93277912a79ef9a137b7f6b  public/models/r1/grass.glb
77e3c87baecfbeada86dc988c7565c7fb45bc77c900e4dd0354f8f09c13757a3  public/models/r1/hook.glb
16e30c9599d7293cbd55b5507ece9f22ab258aaad0b48fc28fa4e635e6bf975e  public/models/r1/manifest.json
e2702a5e1fa47c1e99519809914d997e5b50edfa89b108a6ccf2e9ba37744dd7  public/models/r1/pudge.glb
d40476e49edc4c25ea89d56a45b82d140a2fb346054408845f8cc99a669c52c9  public/models/r1/road.glb
41a5564bbfe862dab67e6b4eb750889c80bd8550609c375a417150d423c1b525  public/models/r1/rock.glb
5758353e0fa8f9929146ca0b397f0d65d10d81632f3fa88795e5bd8d17dd11d7  public/models/r1/shoulder.glb
e5180b21fec7eb774a96538d923e8c1988c0344cd96662826298cd49323113ac  public/models/r1/tree.glb
ba2be96968acdd69ca163683f8faf3fc2a71364388c3b580e3cf9ad72c1fdd2d  src/game/config.ts
fd1b8d14a8752f9cfaf984d3cf827ca1dccc20569ff0ee9c481b65ab1d96e348  src/game/simulation.ts
0b011f875f78791ac71ce3d5fe1c517f217d02aac5f09379ef3906340abe53ac  src/main.ts
7823d9b9a46e3d57e91453c4889a0794891543be0aed0977ad56a5b9f6bc012e  src/platform/connection.ts
3c123cf07f6f0b39da0d86c2654cc109e98d595dcb0bc3c6015225401b0db406  src/platform/input.ts
b0b0c54f170ed7384a196099e6993002f48669665996e043249507b0ef30e834  src/presentation/coordinates.ts
dec74576f2a5020c1b322df2500da19f6d7f08d680d585e42bff8bac140ba42a  src/presentation/models.ts
99a6831a959f3b0a66f2ff6d5316755d98d5429e44cfd826bc4ccf83ed7ec182  src/presentation/timeline.ts
18ec0ddd61e20cd1226acb517666522e27f3857820a6f40760777ec47399ad40  src/presentation/world.ts
d5f67ed2d8bab5f64501dd6a5b6514caf871f0cfddcdfcd81aa22682bb99a05f  src/style.css
da09a91c2e226c689bb32243c8c52e80967accda1596a7d498ee918417474446  tsconfig.json
70f3b9d5e1e4af04aab54fc8ebcf6e6b089d78ee1f2b513860618fb38b111308  vite.config.ts
```
