# Разовое изменение интервала магазина

`set-shop-distance.mjs` выполняется из корня собранного paired backend7b0ed66 с ролью migration owner. Предварительно проверить backup/restore и репетицию в отдельной базе. В обычном приложении права пользователей не меняются.

Утилита разрешает базы foxy/foxy_wood_verify_e785e29/foxy_ci, требует совпадения SHOP_PUBLISH_DATABASE с current_database(), ровно один DATABASE_URL или DATABASE_URL_FILE и active bootstrap revision ca5b0000-0000-5000-a000-000000000001 с250/250. Полный документ клонируется с сохранением денежных строк; изменяются только runtime.shopMinDistance/runtime.shopMaxDistance на100/100. Под type locks создаётся новая immutable revision, CAS меняет pointer, старая ревизия проверяется неизменной. Одна транзакция, rollback при ошибке, секреты в вывод не попадают. published-by отсутствует у операторского изменения, required published-at/schema-version присутствуют; новые admin-права не выдаются.

После таймаута сначала прочитать /api/v1/balance. Повтор с новой pointer отвергается BALANCE_REVISION_CONFLICT. Возврат старой частоты требует отдельной новой balance revision; не редактировать опубликованную запись и не откатывать общую БД.

Репетиция2026-10-05 на восстановленной базе: PASS, прежняя ревизия сохранена, изменены ровно два значения, production всё ещё250м. Клиентские проверки:145 passed/1 skipped, TypeScript и production build PASS; модель15456tris с обеих сторон, floor/clearance/socket/no drift/disposal, cadence100м при2скоростях, freeze/leave/no repeated visit.
