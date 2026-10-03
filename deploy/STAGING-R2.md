# R2: проверенная пара и PostgreSQL 18 на существующем VPS

Этот runbook подготовлен для оператора выпуска. Он не означает, что R2 уже развёрнут. Новый сервер или платная внешняя БД не нужны: PostgreSQL работает на текущем VPS. R1 продолжает слушать свой прежний адрес; R2 сначала проверяется отдельно на loopback-порту 8081.

## Версия и предварительные проверки

Возьмите артефакт одного успешного frontend `R2 verify`: именно он содержит совместно проверенную пару образов, backend SHA и файлы доставки. Не смешивайте frontend с другим backend и не пересобирайте контейнеры на сервере. Сохраните Actions run URL, оба SHA, архив, контрольные суммы и прежнюю рабочую пару за пределами 14-дневного хранения Actions.

На сервере должны быть Docker Engine и Compose v2, действующий HTTPS reverse proxy и доступ оператора для его переключения. Перед запуском проверьте свободную RAM, диск и отсутствие OOM. Для PostgreSQL заданы 384 MiB RAM, shared_buffers 64 MiB и 10 соединений; backend ограничен 192 MiB, frontend 64 MiB. Эти лимиты не доказывают вместимость VPS при реальной нагрузке. При дефиците ресурсов оставьте R1 работающим, устраните причину и повторите проверку.

Из каталога распакованного артефакта:

```sh
set -eu
sha256sum -c SHA256SUMS
docker load -i image.tar.gz
docker load -i backend-image.tar.gz
test "$(docker image inspect --format '{{.Id}}' "$(cat image-id.txt)")" = "$(cat image-id.txt)"
test "$(docker image inspect --format '{{.Id}}' "$(cat backend-image-id.txt)")" = "$(cat backend-image-id.txt)"
cat source-sha.txt backend-source-sha.txt
tar -xzf deploy.tar.gz
```

## Секреты и БД

Создайте один раз два локальных секретных файла. Команда не выводит пароль. Повторное выполнение должно отказать, чтобы не заменить пароль существующей БД:

```sh
sudo python3 - <<'PY'
from pathlib import Path
import os, secrets
directory = Path('/opt/foxy/secrets')
directory.mkdir(parents=True, exist_ok=True, mode=0o700)
password_path = directory / 'r2-db-password'
url_path = directory / 'r2-database-url'
if password_path.exists() or url_path.exists():
    raise SystemExit('Existing R2 credentials: reuse them; do not regenerate.')
password = secrets.token_hex(32)
for path, content in (
    (password_path, password + '\n'),
    (url_path, 'postgresql://foxy_migrator:' + password + '@postgres:5432/foxy\n'),
):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    if path == url_path:
        os.fchown(fd, 1000, 1000)  # UID of USER node in the pinned backend image.
    with os.fdopen(fd, 'w') as file:
        file.write(content)
PY
```

Расположите `deploy/releases/r2.env` по образцу `release.r2.env.example`. Запишите оба image ID из артефакта; этот env-манифест содержит пути к секретам, сами секреты хранятся отдельно. URL-файл принадлежит UID 1000, чтобы непривилегированный `USER node` мог прочитать смонтированный secret; родительский каталог доступен только root. Образ PostgreSQL закреплён manifest digest. Том смонтирован в `/var/lib/postgresql`, как требуется официальному образу PostgreSQL 18; порт БД на хост не публикуется. API R2 не получает пароль мигратора, поскольку профиль и экономические операции ещё не включены.

Из `deploy` выполните:

```sh
set -eu
umask 077
docker compose --env-file releases/r2.env -f compose.r2.yml config --quiet
docker compose --env-file releases/r2.env -f compose.r2.yml up -d postgres --wait --wait-timeout 90
mkdir -p backups
test ! -e backups/before-r2.dump
docker compose --env-file releases/r2.env -f compose.r2.yml exec -T postgres pg_dump -U foxy_migrator -d foxy -Fc > backups/before-r2.dump
docker compose --env-file releases/r2.env -f compose.r2.yml exec -T postgres pg_restore --list < backups/before-r2.dump > /dev/null
docker compose --env-file releases/r2.env -f compose.r2.yml --profile migrations run --rm migrate
docker compose --env-file releases/r2.env -f compose.r2.yml up -d backend frontend --wait --wait-timeout 60
curl --fail http://127.0.0.1:8081/healthz
curl --fail http://127.0.0.1:8081/api/v1/health
curl --fail http://127.0.0.1:8081/version.json
docker compose --env-file releases/r2.env -f compose.r2.yml images
docker compose --env-file releases/r2.env -f compose.r2.yml ps
```

Перед миграцией существующей R2 БД сохраните новый dump с отдельным именем и копией вне VPS. Блок отказывает при существующем `before-r2.dump`: прежнюю копию не заменяйте; для следующего выпуска задайте другое имя в командах. При первой установке dump содержит пустую прикладную схему. `set -eu` прекращает этот блок при ошибке backup/миграции/health; не запускайте новую пару вручную после такого отказа. Сохраните логи и оставьте R1 доступным. CLI проверяет PostgreSQL 18, checksum ранее выполненных миграций и выполняет изменения в транзакции.

Сравните `revision` с `source-sha.txt`, фактические image IDs с обоими файлами ID, а ответ каталога — с упакованным backend. Проверьте обычного крипа, стрелка и босса на настольном браузере и вертикальном телефоне: стрелок убивается одним попаданием, босс переживает первые два и погибает от третьего; контакт, прорыв или вражеский снаряд завершают забег одним поражением. Проверьте паузу/разрыв сети/возобновление. Необнаруженная ошибка TLS на действующем адресе остаётся отдельным блокером выпуска.

После этих проверок оператор переключает существующий HTTPS reverse proxy с порта R1 на `127.0.0.1:8081` и повторяет health, version и игровой smoke через публичный HTTPS. Запишите время, URL, Actions run, обе ревизии/image IDs и результат проверки. Только наблюдение целевой среды подтверждает выпуск.

## Откат

При первом R2 выпуске верните HTTPS upstream на прежний порт R1 и проверьте health/запуск игры. До завершения окна отката сохраняйте R1 контейнеры и предыдущие образы. После возврата трафика остановите только R2 backend/frontend, если они неисправны:

```sh
docker compose --env-file releases/r2.env -f compose.r2.yml stop backend frontend
```

PostgreSQL и его том сохраняются. R1 не использует эту БД; R2 содержит каталог и базовую схему, без профилей игроков и экономических записей. Откат приложений не удаляет таблицы и не откатывает SQL. Не выполняйте `down --volumes`, `docker volume prune`, `docker image prune` или восстановление поверх данных без отдельного решения оператора. Для следующего R2 исправления используйте сохранённый env-манифест предыдущей проверенной R2 пары и тот же том.

Источники: [официальный образ PostgreSQL и его PGDATA](https://hub.docker.com/_/postgres), [метаданные закреплённого образа](https://github.com/docker-library/repo-info/blob/master/repos/postgres/remote/18.6-bookworm.md), [pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html), [pg_restore](https://www.postgresql.org/docs/18/app-pgrestore.html).
