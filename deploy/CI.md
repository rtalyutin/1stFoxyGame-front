# R3/R4: CI и комплект поставки

Проверки дополнены сессиями, экономикой, экипировкой, расходниками, серверным пересчётом и независимой проверкой реальной БД. Container readiness использует БД. Парный smoke проверяет вход, cookie, CSRF, профиль, забег, receipt и выход через фактический proxy. Описание прежних базовых gates ниже остаётся применимым.

# R2: проверка и неизменяемая пара

GitHub Actions `R3-R4 CI` выполняет установку lockfile, проверку типов, `validate:content`, детерминированные тесты R1/R2 и сборку фронта. В `deploy/backend-ref.txt` закреплён полный SHA совместимого backend. Для него выполняются проверка типов, validator каталога, API/контрактные тесты, интеграционные миграционные тесты на реальном PostgreSQL 18 и сборка. Проверка совместимости сравнивает канонический backend-каталог с ожидаемыми правилами клиента.

Затем проверяется реальная пара контейнеров: nginx health, same-origin `/api/v1/health`, frontend revision, backend revision label и `/api/v1/catalog` в точности из закреплённого исходника. CLI миграций исполняется дважды из готового backend-образа против временной CI БД: это проверяет упаковку SQL/каталога и повторяемость. Все проверки относятся к тем образам, которые архивируются.

Триггеры: pull request, push в `main`, `merge_group`, ручной запуск. Имя итоговой проверки — `R3-R4 verify`; правила required checks в GitHub не изменяются этим файлом. Node.js закреплён в `.nvmrc`, npm — через lockfile. Официальные Actions и базовые образы закреплены SHA/digest. Токен имеет только `contents: read`, не остаётся в checkout; код PR работает на одноразовом GitHub-hosted runner. У CI нет секретов среды, SSH, автоматического выпуска или создания платных облачных ресурсов. Пароль `ci_ephemeral_only` используется только временным контейнером PostgreSQL этого job и не является учётной записью сервера.

Артефакт `foxy-front-<SHA>-<attempt>` хранится 14 дней:

- `image.tar.gz`, `image-id.txt`, `source-sha.txt`: проверенный frontend;
- `dist.tar.gz`: собранный frontend с `version.json`;
- `backend-image.tar.gz`, `backend-image-id.txt`, `backend-source-sha.txt`: backend из той же проверенной пары, включая каталог и миграции;
- `deploy.tar.gz`: конфигурация и runbook из той же frontend-ревизии; секретных файлов в нём нет;
- `release.json`: точные source SHA и image IDs обеих сторон, также напечатанные в CI;
- `SHA256SUMS`: контрольные суммы всех перечисленных файлов.

Продвигается один frontend-артефакт целиком. Контрольные суммы подтверждают целостность пакета, источник — GitHub run/ref/SHA. При доставке используют image IDs и не пересобирают приложение. PR-артефакт сам по себе не разрешает production. Порядок staged запуска, миграции и отката: [R3-R4.md](R3-R4.md). История R1 и его прежний compose остаются доступными; эти файлы не свидетельствуют о фактическом выпуске R2.

## Локальная проверка

```sh
npm ci
npm run typecheck
npm run validate:content
npm test
npm run build
```

Для backend повторите его проверки и `DATABASE_URL=<локальная тестовая PG18 БД> npm run test:db`. Команда работает с изолированными схемами, но адрес должен принадлежать тестовой среде. Для backup/restore ей нужны инструменты PostgreSQL 18: в CI указан `PG_TEST_CONTAINER` временного сервиса, локально — этот контейнер либо `PG_DUMP_BIN`/`PG_RESTORE_BIN`. Отсутствие Docker/PostgreSQL локально нужно обозначить как непроведённую проверку; успешная синтаксическая проверка YAML не заменяет реальный Actions run.

Источники: [workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax), [официальный PostgreSQL image](https://hub.docker.com/_/postgres).
