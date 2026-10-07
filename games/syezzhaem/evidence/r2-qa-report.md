# Независимая QA R2 — частичная приёмка

21 PASS / 1 BLOCKED из22 запланированных семейств; ещё5 дополнительных регрессий PASS. Установленных продуктовых FAIL на последнем кандидате нет. Полный gate BLOCKED из-за непроверенного настоящего фона вкладки; фактически наблюдённый технический scope PASS.

Исполнитель /root/onboarding_qa, отдельно от реализации. 2026-10-07. Исходные требования: r2-source-tz.md §§1,3.3,7,8.1 и R2-implementation-contract.md. Авторские тесты не использованы как acceptance oracle.

- Build r2-route-001, map/rules r2-map-1/r2-rules-1, level house-full-route.
- Manifest SHA256: 86e8c6a6885c4237a9d45109369041dd98a42c661251c678c824ebfd8d8a1db9. Все70 served-файлов проверены.
- Own before=after: ca7afbd5711be06fb53def1e59761f457e2796c66799895353ef0b1ca618947d; одинаково для всех4 наборов. Producer sourceDigest: 61288a4239821a0224f31b7b0937497e176a1db69ae37673f90cfd462d2751d0.
- Chromium153.0.8010.0/Linux/ANGLE SwiftShader WebGL2; Node24.19.0, native PostgreSQL18.4, настоящий BetterAuth с проверкой регистрации через тестовый mail sink. Desktop1280×800 и touch844×390/DPR1; реальные CSS/буферы совпали, limits8192.

ПК и touch прошли настоящий маршрут120: tick11077, HP3/core70, серверный finish. Без setState, перемещения к порталу, выставления outcome или ускорения simulation clock. Граничные таймерные/бонусные/коллизионные фикстуры явно помечены synthetic и не заменяют прохождение.

| Семейство | Статус | Фактическое наблюдение |
| --- | --- | --- |
| Q201 | PASS | Pinned R1-map1 native save/resume +6 immutable files; supplemental pinned R1-map2 native resume, actors[]/lava null legacy shape. |
| Q202 | PASS | Populated original metadata unchanged; optional R2 typed EAV; held chest reference and 3 actors survived real SQL/API roundtrip. |
| Q203 | PASS | Desktop/touch two real guided transfers; reload after take restored place step; tick/lava/mob held; cancel/pause caused no transfer. |
| Q204 | PASS | Desktop genuine new server run reached distance120 with ordinary UI and ticks11077; player3/core70; native finish replay exactly once. |
| Q205 | PASS | Touch genuine new server run reached distance120 with trusted native touches and ticks11077; player3/core70; native finish and independent score match. |
| Q206 | PASS | Wood/stone/slime normal take/slot/place; cap12 and invalid occupied/player/chassis/remote cells preserve resources. |
| Q207 | PASS | Original rebuild creates placed UUID/originalId null; stale support rejected; reach5.999/6/6.001 partitions confirmed. |
| Q208 | PASS | One held actor; chest native pick/put/reload/UI pick; carry blocks place; actors never materials; heart unavailable. |
| Q209 | PASS | Chest floor loss made chest land independently while house moved; current road loss used89/90-tick grace; repair prevented heart loss. |
| Q210 | PASS | House waited at gap while lava advanced0.75 in60 ticks; full UI routes filled all gaps and resumed movement. |
| Q211 | PASS | Wood180-tick removal, stone2-hit durability+181 contact-tick immunity, slime landing vy11.5; no external fire spread in partial-timer pairs. |
| Q212 | PASS | Armed84 remains armed after escape; radius2.499/2.5/2.501; one effect; visible countdown and running WebAudio context with played cues. |
| Q213 | PASS | Focused normal Space produced observed flight; pause/save/native readback/reload preserved position/velocity; clear keys; equal90-tick continuation. |
| Q214 | PASS | Native burn remaining127/61/1 roundtrip and uninterrupted/reloaded continuation equal by keyed state. |
| Q215 | PASS | Native fuse79/23/1 plus post-blast readback/retry; HP/damage/timer equal, no repeated blast; extra4 seam regressions PASS. |
| Q216 | BLOCKED | PARTIAL: real touch portrait/landscape change during actual jump with armed mob paused fuse72/tick/input for1370ms and required resume. BLOCKED: headless native background/blur not observable. |
| Q217 | PASS | Server score agreed with independent G14/G15 oracle for cat/chest ×house original/placed/held, shore, falling, destroyed; airborne portal player did not win. |
| Q218 | PASS | Actual fuse1+heart30 at portal resolved lost first; native repeated finish score0/no bonuses. |
| Q219 | PASS | 8 malformed actor/cell/timer/held/material inputs rejected by ok:false VALIDATION_FAILED; revision/readback unchanged; other owner NOT_FOUND. API errors correctly use HTTP200 envelopes. |
| Q220 | PASS | Two verified contexts same revision: one complete actor/material winner atN+1, one REVISION_CONFLICT; no mixed checkpoint. |
| Q221 | PASS | Verified native checkpoint commit then lost ACK; immutable inflight key/body with newer actor/material pending, dedup row1. Actual route terminal offline→finish commit lost ACK→reopen exact retry, history row1. |
| Q222 | PASS | Actual WebGL2 resources/limits/buffer; material words and markers visible at1280×800/844×390,DPR1; exact center under objective yielded trusted scene pointer and exactly1 command on both profiles. |

QA-R2-01 RESOLVED: на исходной сборке abace…b286 native save/readback изменял landing — slime vy11.5 превращался вvy0. На последней сборке4 независимых player+actor damagedstone/slime пар дали одинаковое25-tick продолжение. QA-R2-02 RESOLVED: objective перехватывал касание центра блока; теперь PC/touch центр проходит на canvas, ровно1 команда и соответствующий материал. Старые failing evidence сохранены отдельно. Ошибки первого QA setup/oracle (reach pose, cooldown, readiness, unordered collections, HTTP200 error envelopes) сохранены и не объявляются продуктовой регрессией.

Q216 частично подтверждён: реальный поворот viewport в прыжке и с fuse72 заморозил ticks/fuse/input на1370ms, возврат требовал явного продолжения. Настоящий фон/blur BLOCKED: доступный headless канал не выдал соответствующие native события даже после tab activation, minimize, lifecycle freeze/active и отключения focus emulation. События visibility/blur не инъецировались.

Не проверялись физический телефон/мобильный GPU, hardware FPS/память, внешняя доставка SMTP, VPS/прод и субъективная реакция пользователя. Работа ограничена локальной приёмкой; публикация/активация не выполнялись.

Raw evidence:

- /workspace/scratch/102b8cada1c3/r2-qa/accepted-cases/results.json, summary.json, *.png; stdout /workspace/scratch/102b8cada1c3/r2-qa/accepted-cases.log.
- /workspace/scratch/102b8cada1c3/r2-qa/accepted-full-routes/results.json, summary.json, *.png; stdout /workspace/scratch/102b8cada1c3/r2-qa/accepted-full-routes.log.
- /workspace/scratch/102b8cada1c3/r2-qa/accepted-seams/results.json, summary.json; stdout /workspace/scratch/102b8cada1c3/r2-qa/accepted-seams.log.
- /workspace/scratch/102b8cada1c3/r2-qa/accepted-legacy-intro/results.json, summary.json, *.png; stdout /workspace/scratch/102b8cada1c3/r2-qa/accepted-legacy-intro.log.
- /workspace/scratch/102b8cada1c3/r2-qa/fingerprint-before.json и fingerprint-after.json; raw/harness SHA256 в summary.json.
- /workspace/scratch/102b8cada1c3/r2-qa/compact-results.json и qa-to-coordinator.json — компактные наблюдения и FEATURE_HANDOFF/1, digest 880ed9d2dc0004f39250f4a5c3739840cc1f9c4b37edf78b652dc787f5aa44e4.

Reproduce: native UID shim R1_PG_UID_SHIM=/tmp/r1-pg-uid-shim.so; node --import ./release-r2/back/node_modules/tsx/dist/loader.mjs r2-qa/run-r2.mjs --run --manifest 86e8c6a6885c4237a9d45109369041dd98a42c661251c678c824ebfd8d8a1db9 --label FRESH_LABEL. Для одновременных полных маршрутов: --only Q204,Q205,Q221 --parallel-routes; для остальных семейств отдельный --only список. Chromium /tmp/chromium, LD_LIBRARY_PATH=/tmp.

Return to /root: пересмотреть частичный scope и Q216; настоящий background остаётся необходимым evidence перед заявлением полного PASS. Техническая QA не разрешает выпуск и не подтверждает полезность/эмоциональный отклик.
