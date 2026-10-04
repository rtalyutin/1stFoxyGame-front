# СЪЕЗЖАЕМ! — frontend R1

Браузерная игра для ПК и телефона: движущийся дом, разборка стен и мост, аккаунт, локальная durable очередь, продолжение забега, история и настройки. Оригинальные процедурные кубы Babylon.js. API и БД находятся в парном репозитории `rtalyutin/1stFoxyGame-back`, в таком же каталоге `games/syezzhaem`.

Это отдельный проект. Выполняйте команды из `games/syezzhaem`, а не из корня репозитория первой игры. Node.js 24:

```sh
npm ci
npm run check
npm test
npm run build
```

`npm run dev` запускает Vite на loopback; `/api/syezzhaem` проксируется на API `127.0.0.1:8091`. Запустите парный backend с `AUTH_ORIGIN`, равным точному origin Vite. Для аккаунтов требуется PostgreSQL и подтверждение почты; file-mail разрешён только в явном development режиме. Открытие HTML через file:// не поддерживается.

```sh
BUILD_ID=r1-20261004.002 npm run build
npm run pack:release -- --output Syezzhaem-Frontend.zip
```

`dist/` содержит immutable frontend, `release-manifest.json` проверяет все ассеты. `build-manifest.json` связывает сборку с исходниками. Новый BUILD_ID должен быть уникален; уже опубликованные байты нельзя менять. Publisher `scripts/publish.py` и nginx/launcher находятся в `deploy/`. Общий release root API/nginx, предварительная настройка и команды описаны в [deploy/README.md](deploy/README.md); frontend-команды из этого документа выполняются здесь, backend-команды — в парном проекте.

При первом размещении необходимо подключить маршруты `/games/syezzhaem/` и `/api/syezzhaem/`. Корневой Dockerfile/CI по-прежнему обслуживают первую игру. Сам push не размещает новую игру на VPS.

`src/contracts.ts`, `core.ts`, `snapshot-v1.ts`, `r1-contracts.ts` и `public/content/` идентичны серверным копиям: сервер независимо проверяет тот же снимок и правила. SHA-256 исходного пакета и этих файлов записаны в `source-provenance.json`.

Тесты здесь покрывают core, SnapshotV1, outbox и explicit resume. Независимая приёмка исходного полного пакета: 74 Node-теста и 14 браузерных сценариев PASS; перенос в два проекта отдельно проверен typecheck/test/build. Старое evidence относится к исходному пакету, а не к невыполненному VPS deploy. Физический телефон и настоящий SMTP остаются непроверенными. Подробности R1 — в [README-R1.md](README-R1.md).

Тесты этого проекта называются `*.case.ts` и запускаются отдельной командой Node. Так корневой Vitest первой игры с его стандартным поиском `*.test.*`/`*.spec.*` не захватывает эти проверки.
