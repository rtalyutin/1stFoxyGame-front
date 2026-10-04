Отчёт ниже скопирован без изменений из независимого QA-стенда `onboarding-qa/accepted-marker-fix`. Его относительные пути относятся к тому стенду. В репозитории опубликованы этот отчёт, `onboarding-ui-summary.json`, `onboarding-ui-results.json` (наблюдения всех сценариев без повторяющегося сетевого trace) и `onboarding-fingerprint.json`. Подробный исходный trace и снимки остаются на QA-стенде; SHA исходного results записан в компактных observations.

---

# Независимая QA: учебный старт «СЪЕЗЖАЕМ!»

**PASS — 18/18 сценариев, 0 пропусков, 0 browser errors.** `QA-INTRO-01` закрыт фактическим ретестом. Блокировок локального desktop/touch-emulation gate нет.

Объект: `r1-intro-001`, `house-bridge-portal-intro`, `r1-map-2` / `r1-rules-2`. Manifest SHA-256: `4c6febd8e943f643d409f7fb3319b0f74c6195f748db3770c83f295adc23244f`. Aggregate исполняемых файлов/исходников/данных до и после: `921d6154edd3052bf974336794c2c823489d3854070309f126177f8204367fe7`; совпадает. Проверял `/root/onboarding_qa`, независимо от автора. Записи сценариев: 2026-10-04T20:23:06.019Z — 2026-10-04T20:23:34.913Z.

| Критерий | Вердикт / наблюдение |
| --- | --- |
| Видимая безопасная стена, дом ждёт первого переноса | PASS: состояние tick0/x2 неизменно после1.2с; выбран блок стены, не опора игрока. |
| Реальные клики и касания рамок до готового моста | PASS: wood0→1→0; клетки world9,0 и10,0 заполнены; guide ride, дом продолжает движение. |
| Ярлыки take/place | PASS: мышь и trusted touch выполняют показанное действие; отмена и пауза при удержанном take/place не меняют мир. Enter take и RMB place тоже PASS. |
| Сохранение после взятия + перезагрузка | PASS на desktop и touch: native save ACK; после reload/resume inventory1, правильный place-step, первый перенос всё ещё untimed. |
| Ошибочная клетка пола | PASS: блоки, опора и inventory не меняются. Canvas touchCancel и pause→release тоже без действий. |
| Облегчённые новые правила | PASS: мост2 клетки; observed x=2+tick/60×.45; supportTimer4; сервер принял support_loss_ticks240. |
| Старые R1 партии и immutable данные | PASS: byte-identical map1/house1/rules1/wood1; old snapshot валидируется front/back по rules1; launcher открывает r1-local-001 и продолжает native old run со скоростью.65, support90. |
| Ранее заполненная metadata | PASS: исходный seed→новый seed сохраняет required support_loss_ticks min0/max90. |

Исходный дефект QA-INTRO-01: в manifest `fcdc30cc4857641f4192e06f9ad548489d0467ca20cc64a2a568f485020be409` touch ярлыков выбирал соседнее место, take/place отклонялись. На текущей manifest `4c6febd8e943f643d409f7fb3319b0f74c6195f748db3770c83f295adc23244f` оба ярлыка работают; отрицательные сценарии take/place пройдены. Старые raw FAIL сохранены под `../marker-check/`; на новую сборку не перенесены.

Среда: Chromium153.0.8010.0/Linux, WebGL2 ANGLE SwiftShader; desktop1280×800 и эмуляция touch844×390, DPR1, реальные drawing buffers тех же размеров. Использованы настоящие Better Auth регистрация/верификация/сессия и PostgreSQL non-owner runtime с RLS; mail sink локальный. Cookies, токены и пароли не логировались.

Физический телефон и аппаратная плавность: BLOCKED/оборудование недоступно, эмуляция их не подтверждает. VPS/прод, внешний SMTP и субъективная реакция игрока не проверялись; отдельного FPS-порога для этого gate не задано. Технический PASS не разрешает публикацию.

Raw/evidence в этой папке: `results.json`, `summary.json`, `fingerprint-before.json`, `fingerprint-after.json`, `harness-script.mjs`, `git-state.txt`, `qa-handoff.json`, PNG-снимки. Process log: `../accepted-marker-fix-run.log`. Полный отчёт: `report.md`; изолированные исполняемые копии: `back/`, `front/`, `served/` (не требуются для обычной публикации evidence).

Важные снимки: `touch-marker-01-before-take.png`, `touch-marker-02-after-label-take.png`, `touch-marker-03-before-place.png`, `touch-marker-04-after-label-place.png`, `desktop-04-resume-place.png`, `touch-04-first-place.png`, `desktop-07-bridge-ready.png`, `touch-07-bridge-ready.png`, `legacy-01-resume.png`, `legacy-02-moving.png`.

Воспроизведение: `QA_LABEL=<new-label> QA_INCLUDE_MARKER=1 LD_LIBRARY_PATH=/tmp/r0-browser R1_PG_UID_SHIM=/tmp/r1-pg-uid-shim.so node --import /workspace/scratch/102b8cada1c3/onboarding-r1/back/node_modules/tsx/dist/loader.mjs onboarding-qa/qa-intro.mjs`, cwd `/workspace/scratch/102b8cada1c3`. Точная версия harness сохранена в `harness-script.mjs`; module paths привязаны к этому стенду. Только QA artifacts изменялись исполнителем.

FEATURE_HANDOFF/1 digest `880ed9d2dc0004f39250f4a5c3739840cc1f9c4b37edf78b652dc787f5aa44e4`; evidence_status VERIFIED, gate_verdict PASS, action_decision CONTINUE, hypothesis_assessment NOT_ASSESSED, operation_status SUCCEEDED. Return to /root.
