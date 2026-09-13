# PenDrops — Расписание медколледжа (PWA)

> **PenDrops** — современное PWA-приложение для просмотра расписания медицинского колледжа. Работает офлайн, обновляется в реальном времени через Supabase, публикуется админом через drag-and-drop Excel.

---



**Открыть:** `http://localhost:8080/pendrops/` → меню браузера → «Установить приложение» (PWA).

---

## ✨ Возможности

| Категория | Детали |
|-----------|--------|
| **Парсинг Excel** | `.xls` / `.xlsx` через SheetJS (ленивая загрузка 881 KB) |
| **Структура листа** | Авто-поиск шапки (`Апта күндөрү`), блоки `[День \| Пара \| Время \| Группы…]` |
| **Группы** | Коды `ПСТ-1-25`, `ЛД-2-23`, `ФЯ-4-25 (1)` — авто-извлечение из заголовков |
| **Подгруппы** | Разбивка ячеек по `/` (несколько подгрупп в одной ячейке) |
| **Парсинг ячейки** | Предмет, тип (лекция/практика/лабораторная/экзамен), аудитория, преподаватель |
| **Дни недели** | Кыргызский (`Дүйшөмбү`…) → русский, алиасы (пн/понедельник/mon) |
| **Фильтры** | Отделение → Группа → Подгруппа → День → Неделя (1/2) → Поиск |
| **Live UI** | Таймеры до пары, прогресс-бар, hero-блоки (перемена/до пар/после пар) |
| **Офлайн** | localStorage → IndexedDB fallback, кэш расписания |
| **Realtime** | Supabase Realtime — мгновенные обновления после публикации админом |
| **PWA** | Manifest, иконки 192/512, Share Target, File Handlers, установка на экран |

---

## 🏗 Архитектура (Clean Architecture)

```
src/
├── core/
│   ├── domain/
│   │   ├── entities/types.ts          # Lesson, Sheet, Group, ScheduleData
│   │   ├── repositories/ports.ts      # IScheduleRepository, IAuthProvider, IStorage
│   │   └── use-cases/schedule.ts      # Чистая бизнес-логика
│   └── application/
│       ├── services/index.ts          # ScheduleService, PreferencesService, AuthService, AdminService
│       └── dto/index.ts               # DTO для границ слоёв
├── infrastructure/
│   ├── supabase/
│   │   ├── client.ts                  # Браузерный клиент (только anon key)
│   │   ├── repository.ts              # SupabaseScheduleRepository (Realtime, CRUD, publish)
│   │   └── auth.ts                    # SupabaseAuthProvider (Edge Function verify-pin)
│   ├── storage/hybrid.ts              # localStorage → IndexedDB fallback
│   └── github/parser.ts               # ExcelFileParser (ленивый SheetJS)
├── presentation/
│   ├── stores/
│   │   ├── signals.ts                 # Реактивные сигналы (Preact/Solid-style)
│   │   └── appStore.ts                # Центральное состояние + filteredLessons
│   └── swRegistration.ts              # Регистрация SW (удалён, используем Realtime)
├── main.ts                            # Composition root (bootstrap, UI binding)
├── view/                              # Legacy JS views (scheduleView, adminView, toast, errorBoundary)
└── core modules (JS)                  # sheet, cell, day, timing, text, constants, store, types/lesson
```

**Принципы:** Dependency Inversion, Repository Pattern, Signals/Reactivity, Edge-ready, Type-safe end-to-end.

---








---

## 📁 Структура репозитория

```
pendrops/
├── .github/workflows/          # CI/CD
├── public/                     # Статические ассеты (manifest, icons, xlsx)
├── scripts/                    # Утилиты (hash-pin, fix-rls, update-pin-hash)
├── src/
│   ├── core/                   # Домен + Application (TS)
│   ├── infrastructure/         # Supabase, Storage, Parser (TS)
│   ├── presentation/           # Stores, UI binding (TS)
│   ├── view/                   # Legacy JS views
│   ├── main.ts                 # Entry point
│   └── *.js                    # Legacy core modules
├── tests/                      # 138 тестов (unit/edge/store/security)
├── .github/workflows/          # CI/CD
├── .env                        # Локальные секреты (НЕ в git)
├── .gitignore
├── package.json
├── tsconfig.json
├── vite.config.js
└── README.md
```

---

## 🚀 Деплой

1. **Push в main** → CI проходит → Deploy workflow собирает и деплоит на GitHub Pages
2. **URL:** `https://telikuy070-collab.github.io/pendrops/`
3. **Кэш:** Версия в `vite.config.js` (`__APP_VERSION__`) бампается для cache-busting


---

## 📄 Лицензия

MIT — свободное использование, модификация, распространение.

---

**PenDrops** — сделано с ❤️ для студентов медколледжа.
