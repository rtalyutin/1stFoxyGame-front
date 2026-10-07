# Последний трон — браузерный клиент R3

`web/` содержит canonical R3 клиент:15волн, пять героев, вылазки, предметы, выбор награды и Aegis. Единственный core/server/db — в `1stFoxyGame-back/games/last-throne`. После assembly импорты `../../core` используют эту пару, второй core здесь не создаётся. Первая игра и актуальная геометрия общего хаба сохраняются.

Для восстановления общего workspace использовать backend `deploy/last-throne/assemble.mjs`, ready Last-Throne-R3.zip с exact R0/R1/R2/R3 и Node24. Описание параметров и установки — backend `deploy/last-throne/README.md`. Generated workspace и ready archives не коммитятся.

R1/R2 продолжаются только своим exact клиентом, с прежними5/10волнами и save2/3; R3 имеет save4. Публичный маршрут на общем сервере `/td/`, доступность требует реальной серверной проверки. Наличие исходников не означает установки.

`hub/scripts/activate-last-throne.mjs` проверяет HTTPS, exact R3 manifest/content/API и каждый web-файл, затем создаёт отдельный каталог для HUB_CATALOG_FILE. Исходный games.json остаётся «Скоро» до размещения и публичной QA. См. docs/hub/README.md.
