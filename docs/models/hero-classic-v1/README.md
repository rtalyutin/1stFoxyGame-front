# Classic hero v1 — local integration

`public/models/r1/pudge.glb` now contains the approved classic hero: 16,568 triangles, seven meshes/materials, 46 skin joints, nine clips and five contract sockets. GLB size: 7,706,740 bytes. SHA256: `306a5c72afed601d096a02b4c179accd76d9aa8e6843405b33f1804f7c200cbe`.

Source geometry and painted albedo are Valve classic Pudge assets from installed Dota 2. Assembly, body subdivision, rig adaptation, gameplay animation preparation and baked normal/ORM materials were performed in Blender. The editable native and reproduction scripts are retained in the sibling authoring package `runner-forge-hero-v1`; its approved native SHA is `471a81bd761e987267c7b93ab079f8ca84e365f23ce1132a250220d3d78ad2cf`.

The contract preserves a static identity `hero_root`, metres/Y up/+Z forward, five sockets and nine clip names. The reference hook is excluded because WorldView already owns a separate hook. R4 wearables built for the former 18-bone rig require a separate retarget; this runtime does not load them.

Close targets can return the hook before hook_cast finishes. ModelActor blends displayed TRS for 120 ms on the simulation clock, with a temporary grounded support offset during the transition. Identical pose/clock/root matrix samples return from cache so paused transitions do not keep CPU skinning the mesh. Gallery and clock rollback reset transitions; death uses terminal simulation time plus visual death seconds. Combat, hitboxes, input and balance are unchanged.

Verification: 149 tests passed, one existing skip, TypeScript and production build passed. The actual GLB is tested across 4,713 sampled poses at 480 Hz, canonical loops/endpoints, real 4 m/25 m/miss RunSimulation switches, actual paused/SHOP phases, fixed-clock death, cache invalidation and disposal. `runtime-verification.json` and `hero-runtime-front.jpg` record the local Babylon render. Browser materials were ready with no warning/error logs. Responsive framing was reviewed at 390×844; local PC FPS does not establish physical-phone performance.

Run `vitest run` normally; optional evidence output requires an explicitly supplied `RF_HERO_EVIDENCE_DIR`. The development-only `hero-preview.html` uses the same WorldView; it is omitted from production entrypoints.

Human Form approval: 2026-10-05. Local Runtime QA: passed. Human Runtime approval: pending. Main publication and deployment: not performed for this revision.
