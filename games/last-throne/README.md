# Последний трон — браузерный клиент R3

`web/` содержит canonical R3 клиент:15волн, пять героев, вылазки, предметы, выбор награды и Aegis. Единственный core/server/db — в `1stFoxyGame-back/games/last-throne`. После assembly импорты `../../core` используют эту пару, второй core здесь не создаётся. Первая игра и актуальная геометрия общего хаба сохраняются.

Для восстановления общего workspace использовать backend `deploy/last-throne/assemble.mjs`, готовую поставку камеры с exact R0/R1/R2/R3 и новым immutable `r3-content-002` и Node24. Описание параметров и установки — backend `deploy/last-throne/README.md`. Generated workspace и ready archives не коммитятся.

R1/R2 продолжаются только своим exact клиентом, с прежними5/10волнами и save2/3; R3 имеет save4. Публичный маршрут на общем сервере `/td/`, доступность требует реальной серверной проверки. Наличие исходников не означает установки.

`hub/scripts/activate-last-throne.mjs` проверяет HTTPS, exact клиент камеры `r3-content-002`, прежний API `r3-001`, неизменный backend/content и каждый web-файл, затем создаёт отдельный каталог для HUB_CATALOG_FILE. Исходный games.json остаётся «Скоро» до размещения и публичной QA. См. docs/hub/README.md.

Камера меняется только в новом клиенте; core r3-core-1, content r3-content-1, metadata r3-meta-1 и save4 сохраняются. Приватная CLI content выбирает новый launcher без image/API restart. Exact r3-001 и его открытые партии/сохранения остаются доступными; Git-код сам по себе игру на сервер не устанавливает.
