# R3/R4: независимая проверка

Проверяемая область — магазин, постоянный профиль, серверный replay боя, экипировка и расходники, без новой графики. Основание: запрос «Реализуй релиз 3 и 4. Без графики», [контракт R3/R4](r3-r4.md) и исходные критерии плана/GDD, извлечённые в `r34-requirements.json` (SHA-256 `e5a194c2ac68eb025a1e58e5171d5f2d6759418d98f20b07b046df7fc4e62288`). Проверяющий подготовил сценарии независимо от авторских тестов.

**Результат проверенной области: PASS / VERIFIED.** Пройдены независимые локальные сценарии и настоящая PostgreSQL 18.6 в CI. Paired frontend CI — отдельный gate, ожидаемый после публикации этого отчёта. Production-развёртывание не проверялось.

| Проверка | Выполнено | Результат и граница доказательства |
| --- | --- | --- |
| Боевая симуляция | 10 независимых сценариев | PASS: вход в магазин за 2 мс до контакта на 8 мс; смерть при равном времени выигрывает; пропуск/повтор магазина; заморозка всех таймеров и RNG; параметры старого каста; пробивание и возврат; три отдельных каста на босса; расходники и повреждённый снимок. |
| HTTP/API и авторизация | 9 независимых сценариев через настоящие Fastify handlers/service | PASS: вход без регистрации; сессии/отзыв/истечение; CSRF/Origin/cookie; чужие item/run/operation; одинаковый operationId и изменённый payload; серверная цена; явный takeover и отказ старому клиенту; запрет mint/kill/spawn; расход 3→2 и смерть; storage503. Явно внедрён `MemoryRepository`: SQL здесь не исполнялся. |
| Браузер | Chromium 141 / Playwright 1.56.1, Node 24.19.0; 17 сценариев на ширинах 320, 390 и 1440 | PASS: настоящий DOM и UI, TCP API и серверный бой; вход → countdown → бой → магазин → craft/equip/upgrade → reload; потеря ответа после commit с lookup исходного operationId; расход без запуска крюка, смерть и reload; focus/blur; повреждённый снимок; duplicated-tab clientId; второй клиент после gameOver. Нет pageerror и горизонтального переполнения. |
| Реальная PostgreSQL 18.6 | 9 независимых SQL сценариев; полный SQL job37/37 | PASS в финальном CI 37143189853: повтор provisioning и wallet >2^53, полный rollback после реального SQL trigger failure, управляемая конкуренция, dedup/revision/ownership, reward+terminal snapshot, расход/повторное чтение и настоящий pg_dump/restore (64291 байт). Все37 SQL tests PASS,0 fail/skip/cancel; runtime RLS и ограничения БД также прошли. |

Браузерный тест использует явный MemoryRepository и синтетические серверные shop/death fixtures для ограниченного воспроизводимого сценария; создание первого забега, все цены, списания, экипировка, расходники и replay проходят реальный сервис. Дополнительный read-only observer добавлен в ответ Vite только для чтения состояния тестом. Product files и маршруты для fixture не изменялись. Скриншоты осмотрены для читаемости, остаются внутренними доказательствами и не публикуются как новая графика.

Получены конкретные подтверждения: fast_reel списывает 100000 milli и 2 стали; upgrade до уровня 2 заменяет значения на return×1.3/cooldown1.7; потерянный ответ craft не создаёт лишний предмет; collector 3→2 остаётся 2 после смерти/reload, эффект исчезает; level/loadout сохраняются. Скопированный sessionStorage clientId получает новый UUID, живой второй клиент остаётся readOnly и требует явного takeover. Завершённый readOnly забег допускает галерею, экипировку и новый забег. Неполный snapshot без state допускает только безопасное завершение по отдельному runId, сохраняя имущество. Нажатие D сразу после запуска достигает canvas; blur очищает удержанный ввод и замораживает подтверждённый бой.

## Проверенная версия и доказательства

Финальный backend PR head: `25d2036a58aa49754558b738d641c28799ac2525`; фактический CI merge checkout: `92c660019c51cd759f0fa2ce2ca1c4cde81ee9f5`. Оба Git tree равны `bd8e3a476e8a1251042bddccae06b92f898d7912`; координатор проверил SHA/mode всех60 файлов публикации. Независимая QA сверила runtime manifests: frontend не изменился, backend отличается от финального browser manifest только npm script SQL-тестов. Backend исходная проверенная публикация: `8ba2bfe3f69da263980598253e02f1f2b53f1727`; повтор API относится также к `eb693ae416805007bf8e75b3a2071c59dead467c`. Между публикациями изменён только npm script таймаута SQL-тестов и независимый QA runner; исполняемые backend source/content/contracts остались теми же. Внутри финального браузерного прогона полный frontend/backend manifest не менялся. После финальных изменений npm script короткий API прогон повторён на текущем backend: 9/9 PASS, before/after manifest равен.

| Исполняемый файл | SHA-256 |
| --- | --- |
| Frontend `src/main.ts` | `cda74c711b81cc967c4d1de36c6186c73a86f0e63457bb3d437fbc43b9f4c4de` |
| Frontend `src/platform/profile.ts` | `6491bf5438dda98b69328c72652ed4c4179aec8cb3a4e27ff37390e5128da92c` |
| Frontend `src/game/equipment.ts` | `ba64af6f313301d9924b7531c75b232883aaa50fbb84820c2a8b548508aac27d` |
| Frontend `src/game/simulation.ts` | `ede4bc328de742e554973c322681c2eaea00ea81522cdf9125b55ca4a12cee70` |
| Backend `src/app.ts` | `3a2fedd1f960f6db28feaa8325c91742917d85bc4bfb0617a4a36bdf318a46ee` |
| Backend `src/profile/service.ts` | `4fcd365ff6f70699a589493665a0e01c77a48245dd235ed55936fc266172b311` |
| Backend `src/profile/repository.ts` | `97fd6ecb52bcee34289ef0028b4d440a3ab6273b9c0940bbbaa8339446f47d8a` |
| Backend `src/game/rewards.ts` | `e7d542de9e789b6160f601906532680696ec9f954d922e2dbe8781d92c22e25a` |
| Backend `content/rewards.json` | `8c0f30df65772ea1beddf524627d0e325cac0cd0da5322e4067295d53a923bc0` |

Полные before/after manifests, JSON результаты и raw stdout сохранены раздельно для каждого прогона: `independent-combat.*`, `independent-api.*`, `independent-browser.*`, `evidence-manifest.json`. Браузерный manifest всех source/config/package файлов имеет SHA-256 `3951f0a1d4ecafa2cffed5a3e8a354ad63de426dc763959a1cec00fff05fbf15`; backend manifest на момент браузерного прогона — `1810f00cd76fd51dcb61fda384d6b5fe943bdf62a49ec70cad164f3f17a4025b` (канонический JSON: sort_keys, compact separators). Raw headers, cookies, пароли и реальные пользовательские данные в этот отчёт не включены.

В QA workspace воспроизведение:

```sh
node --import ./r34-back/node_modules/tsx/dist/loader.mjs r34-qa/independent-combat.ts
node --import ./r34-back/node_modules/tsx/dist/loader.mjs r34-qa/independent-api.ts
node r34-qa/independent-browser.cjs
```

SQL runner размещён в backend `test/db/independent-r34.test.mjs`. CI команда: `npm run test:db` с настоящим `DATABASE_URL` PostgreSQL 18; runner не использует silent skip. [CI backend](https://github.com/rtalyutin/1stFoxyGame-back/actions/runs/37143189853) завершился SUCCESS; прочитаны raw job/container logs и identity фактического checkout. Помимо SQL, прошли Docker packaging/readiness и provisioned login/cookie/profile/run/receipt/CSRF/logout smoke; packaged миграции через env и файл повторились с0 новых миграций. [Backend artifact](https://github.com/rtalyutin/1stFoxyGame-back/actions/runs/37143189853/artifacts/11280729822), SHA-256 `c9453bcb753bfa828b10055ac26137dabc09c7e9b8bca52d042f82ad11f5f54a`. Raw final log SHA-256 `7f950c58478d3dbd0a0e6676658dc9c74d76aad621283f7c1684cf179ae58b07`; sanitized results — `independent-postgres-37143189853.json`.

## Исправления и ограничения

**PG-R34-01, подтверждённый блокер SQL:** CI `37142247150`, PR head `eb693ae416805007bf8e75b3a2071c59dead467c` / фактический merge checkout `5fe608372a3b8ccfa1f0b596cd3efcddee0a3b2a`, исполнил настоящую PostgreSQL 18.6 и получил `record "old" has no field "entity_id"` при COMMIT в `profile_validate_ownership()`. Миграция 003 использовала один SQL CASE для триггеров двух таблиц с разным record shape. Прочитаны raw job/container logs; это ошибка продукта, не отсутствие PostgreSQL и не MemoryRepository результат. Исправлены отдельные IF для таблицы/операции; новая миграция SHA-256 `a6eb4b6b6eabb3145bb183e1fad24679c96fbd3169576883e0926e58278819f2`. CI `37142739866` исполнил новый merge checkout `7d7301d36ad82559207edf125961c0800e0730d1`: все9 независимых SQL сценариев прошли, ошибка trigger не повторилась. Остался один отказ в author-test: `SELECT id` при JOIN давал неоднозначную колонку; итог37=35 pass +2 fail (nested и parent),0 skip/cancel. Это исправляется квалификацией `p.id`, не ослаблением ожидаемого ограничения. Повторный CI `37143189853` после этой коррекции: **37/37 PASS,0 fail/skip/cancel**; оба отказа закрыты фактическим SQL retest. Отменённый предыдущий job не считался PASS.

Подтверждённый QA дефект: Vite менял upstream Host, поэтому валидный browser Origin получал login403. Исправлено сохранением Host; финальный полный proxy/browser прогон получил login200 и PASS. Отдельные ранние прогоны признаны STALE из-за редактирования source во время исполнения. Два отказа исправлены в QA oracle/fixture: ожидание UI PAUSED раньше server acknowledgement и отсутствующий начальный clock credit0.25 у вручную созданного run. Они не классифицированы как дефекты продукта; исходные логи сохранены.

Не проверялись физический Android, баланс/темп экономики, новые модели/текстуры/VFX, нагрузка, реальный production, полный dependency/security audit, реальные credentials и операционные RPO/RTO/retention. Ограниченная проверка безопасности относится к перечисленным session/ownership/CSRF/replay границам. Подтверждённых открытых локальных runtime-дефектов в проверенной области нет; SQL исправление подтверждено фактическим retest. Проверка хранения относится к перечисленным commit/readback/backup сценариям на PostgreSQL18.6; реальная production-готовность и её эксплуатационные параметры не объявляются.
