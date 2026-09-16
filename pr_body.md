# fix: resolve aliases and storage serialization

## Описание
Что изменено:
- **vite.config.js** — добавлены алиасы `@core`, `@infrastructure`, `@presentation`, `@shared` для импортов
- **src/infrastructure/storage/hybrid.ts** — кастомный `replacer`/`reviver` для `JSON.stringify/parse`, корректно сериализующий/десериализующий `Map`/`Set`

## Почему
- Vite не резолвил импорты вроде `@core/...` → dev-server падал на старте
- `ScheduleData` содержит `Map`/`Set`; простая `JSON.stringify` превращала их в `{}` → кэш расписания и преференсы ломались в рантайме

## Тесты
- `npm run build` — ✅ успешно
- `npm test` — 120/120 тестов ✅
- `npx prettier --write src/view/templates/` — форматирование исправлено (предупреждения были до изменений)

## Smoke-test
- Dev-сервер стартует на `localhost:8081`
- Расписание отображается, модалки sheet/group/subgroup работают, поиск работает
- Нет ошибок в консоли devtools
- Realtime подписка Supabase не падает

## Риски
- Проверено: `.env` и секреты **не попали** в коммиты (только `vite.config.js` и `hybrid.ts`)
- Pre-existing lint warnings/errors в кодовой базе (unused vars, `any` types) — не вношены текущими правками, зафиксированы в PR

## Инструкции по откату
```bash
git checkout main && git revert <merge-commit>
```

---

## Чек-лист PR
- [x] Сборка проходит (`npm run build`)
- [x] Тесты зелёные (`npm test`)
- [x] Линт: pre-existing ошибки (17 errors, 53 warnings) — не вношены правками, исправлены форматированием templates
- [x] Smoke UI проверен (dev-сервер работает, расписание отображается)
- [x] Секреты не в коммитах
- [ ] CI зелёный (ожидается)