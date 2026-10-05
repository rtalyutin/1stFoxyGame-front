# Runner Forge — reference creep, native v3

The rounded red v2 was rejected. This version uses the actual wood/leaf Radiant melee model found in the locally installed Dota 2, matching the user's supplied reference. The source geometry and painted albedo are Valve game assets; they are not newly authored geometry or a newly painted texture. Local extraction/import and shader/clip preparation are recorded here separately.

## Repository delivery and verification snapshot

This directory contains `README.md`, `export-verification.json` and `runtime-verification.json`. The game asset is `public/models/r1/creep_basic.glb`. The native authoring files, scripts, maps and screenshots listed below belong to the separately preserved local authoring pack, not this repository directory. Runtime verification is a dated local QA snapshot from2026-10-05, before publication; its `published` and `deployed` flags describe that snapshot, not live server state. Server release evidence is maintained separately.

- `Runner-Forge-Creep-Wood-v3.blend`: prepared asset in `Wood_Creep_Asset` and static `Wood_Creep_Review`. Human Form approved2026-10-05; saved native preserved unchanged after verification.
- `creep_basic.glb`: final game export,2919824 bytes, SHA256 `6e021f016179bbd090d01707cfd17c3c1afa402df3edfe300a3e3d5fa79d0f40`. Included at `public/models/r1/creep_basic.glb`; this document does not assert a live deployment.
- `export-wood.py`, `wood-export-verification.json`, `wood-runtime-verification.json`: reproducible selected export and actual Babylon/browser verification.
- `wood-runtime-closeup.png`, `wood-runtime-lineup.png`, `wood-runtime-capture.png`, `wood-runtime-stress.png`, `wood-runtime-portrait.png`, `wood-runtime-gameplay.png`: actual browser captures.
- `wood-updated-review.png`: full current material/shape render.
- `wood-animation-review.png`: representative run, hit and captured poses, left to right.
- `wood-authoring-verification.json`, `wood-native-verification.json`: exact counts, hashes and checks.
- `prepare-wood.py`, `validate-wood.py`: reproducible native preparation and independent saved-file verification.
- `Runner-Forge-Creep-Wood-Source.blend` and `reference-source`: imported source archive, preserved separately.

## Source and preparation

Source path: `models/creeps/lane_creeps/creep_radiant_melee/radiant_melee.vmdl_c` inside local `game/dota/pak01_dir.vpk`. Only that model and its dependencies were read. The VPK installation was not modified.

Powered by [Source 2 Viewer](https://s2v.app) ([ValveResourceFormat](https://github.com/ValveResourceFormat/ValveResourceFormat)), official CLI release20.0. Downloaded ZIP SHA256: `d32ab327b8bbb42a2528866afb03bb582bdb779d0005488da32b90292afd3ff5`, matched the official GitHub release digest. CLI is task-local; no system installation. [Official CLI documentation](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/master/docs/guides/command-line.md).

2859 triangles versus710 in the currently shipped creep: body2761, separately skinned blade98. Both meshes share one material and the source40-bone rig. The leaf, horn, bark, claw, root-foot and sword silhouettes were retained. Extra subdivision was avoided because the reference intentionally contains visible hard edges.

The original512px painted albedo and UVs are preserved. New native PBR bakes: tangent Normal1024, ORM512 and Emissive512. Tree and leaves are nonmetallic; cloth is rougher; blue eyes/gem have a small emission. AO channel is constant1 because the painted texture already contains shading. Normal is baked from the source normal at moderate strength. All final maps are packed in the .blend. Actual texture sizes and hashes are in the authoring report.

## Client compatibility

The actual current frontend contract requires `enemy_root`, `socket_creep_capture`, and `run`, `hit`, `death_capture`. It does not require18 bones. The new native asset retains40 source bones and an independent static external root. The torso socket is attached to `Spine_2`.

Compatibility clips are prepared natively: source `run` → loop0.8s, full source `death` → `hit`0.6s, final fallen pose → `death_capture`1s. The timing preserves the current simulation's fallen-state handoff. Vertical root translation was baked to correct ground clearance, with no route motion added to the external root. The run loop endpoint matches its first pose. SOURCE_* actions remain an archive in native Blender; only three NLA tracks are intended for the eventual runtime export.

Saved-file QA sampled1155 poses at1/16-frame intervals. Finite geometry, normalized weights, binding, UVs, packed maps, static root, torso socket, run seam and hit→capture handoff passed. The final exported GLB was independently sampled in Babylon at480Hz (1155 poses), including key midpoints. Floor, run seam, fallen pose handoff, socket, independent rigs, optional blade visibility and disposal passed.

## Completed export and local integration

Export selected objects only from `Wood_Creep_Asset`: `enemy_root`, `RF_Wood_Creep_Rig`, `RF_Wood_Creep_Body`, `RF_Wood_Creep_Blade`, `socket_creep_capture`. Review copies and SOURCE_* archive animations are excluded. Exactly three nonempty runtime groups retain their durations. Temporary240Hz sampling preserves the native subframe floor corrections; it does not change native30fps or the simulation tick rate. A30Hz export caused7mm ground penetration and was replaced. The external root remains static with uniformscale .466116667 andtranslationY .0102307443, not identity.

Normal creeps keep the blade. Strong and boss actors hide it per instance; their procedural guns follow the animated `weapon1_0` joint along its local+X rather than floating beside the moving hand. Boss scale is inherited once. Body/Blade geometry and PBR material stay shared; actor rigs remain independent.

Local preview: `http://127.0.0.1:5176/creep-preview.html`. This dev-only page uses the production `WorldView` and unmodified `RunSimulation`; it offers synthetic pose/stress probes plus real casting and a standard game run. It is not a new production UI entry. Browser PBR texture readiness, all three kinds, capture socket alignment, cast/kill/return, pause and gameOver were checked. Portrait viewport390×844 fit was inspected, not phone hardware tested. Short animated11-actor desktop sample1280×720 DPR1:361frames/2.503s, rollingFPS140.58–147.93, mean144.05. This is not a broad performance claim.

Final checks:15Vitest files,132passed/1skipped; TypeScript and Vite production build passed; diff whitespace check passed; browser warnings/errors0. A pre-existing bundle-size advisory remains. Logs are saved in `wood-client-tests.log` and `wood-client-build.log`.

The game model and presentation are included in this change. Source geometry and painted albedo are Valve assets; no rights or license for external distribution have been asserted by the local import. The original live R1 Blender file and source VPK were not overwritten. The local authoring pack retains the baseline GLB as `creep_basic-baseline-1071114.glb`.
