# PenDrops — Расписание медколледжа (PWA)

> **PenDrops** — современное PWA-приложение для просмотра расписания медицинского колледжа. Работает офлайн, обновляется в реальном времени через Supabase, публикуется админом через drag-and-drop Excel.

---

## 🚀 Быстрый старт

```bash
# Клонирование
git clone https://github.com/telikuy070-collab/pendrops.git
cd pendrops

# Установка зависимостей
npm ci

# Разработка (HMR на порту 8080)
npm run dev

# Продакшн-сборка
npm run build

# Предпросмотр сборки
npm run preview
```

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

## 🗄 Данные (Supabase)

| Таблица | Назначение | RLS |
|---------|------------|-----|
| `lessons` | 786 уроков (id, sheet_id, day, day_order, time, para, group_code, subgroup, subject, type, teacher, room, is_exam) | ✅ Read (anon), ⚠️ Write (нужен `scripts/fix-rls.sql`) |
| `schedule_version` | Версионирование (version, updated_at, file_name, file_size) | ✅ Read (anon), ⚠️ Write (нужен `scripts/fix-rls.sql`) |
| `admin_config` | PIN hash (`admin_pin`) | ✅ Read (service_role via Edge Function) |

**Realtime:** ✅ Включён на `lessons` + `schedule_version` — мгновенные обновления UI.

**Edge Function:** `verify-pin` — хеширует PIN на сервере (соль `pendrops-salt-2026`), хеш никогда не уходит на клиент.

---

## 👑 Админка

| Действие | Детали |
|----------|--------|
| **Открытие** | 10 тапов по логотипу 💧 ИЛИ долгое нажатие (1.5с) |
| **Авторизация** | PIN → Edge Function `verify-pin` → `{ valid: boolean }` (хеш никогда не уходит на клиент) |
| **Публикация** | Drag & drop `.xls/.xlsx` → `adminService.publishFromExcel()` → Supabase `lessons` + `schedule_version` |
| **Realtime** | UI учеников обновляется автоматически через 1-2 сек |
| **Git** | Не используется — данные только в Supabase |

**PIN по умолчанию:** `6137` (хеш: `0704d7bc79ee526aeca17741d7174920d53b399fd979fa0e7df466d48d640e2b`)

---

## 🛠 Команды

```bash
# Разработка
npm run dev              # Vite dev server (порт 8080)
npm run dev:teacher      # Teacher PWA (отдельный конфиг)

# Сборка
npm run build            # tsc --noEmit + vite build
npm run build:teacher    # Teacher PWA build

# Проверки
npm run typecheck        # tsc --noEmit
npm run lint             # eslint + prettier
npm run test             # vitest run (74 unit)
npm run test:edge        # 35 edge-case тестов
npm run test:store       # 9 store audit тестов
npm run test:security    # 20 security тестов

# Утилиты
node scripts/hash-pin.mjs 6137        # Генерация хеша PIN
# SQL для Supabase: scripts/fix-rls.sql, scripts/update-pin-hash.sql
```

---

## 📦 CI/CD

| Workflow | Триггер | Действия |
|----------|---------|----------|
| **CI** (`.github/workflows/ci.yml`) | Push/PR на main | typecheck, lint, test (unit/edge/store/security), build |
| **Deploy** (`.github/workflows/deploy.yml`) | Push на main (после CI) | Build → upload-pages-artifact → deploy-pages |

**Секреты GitHub (Settings → Secrets → Actions):**
- `VITE_SUPABASE_URL` — `https://bnzcfhtmzvxxiwfkdryn.supabase.co`
- `VITE_SUPABASE_ANON_KEY` — `eyJ...` (anon/public key)

**Base path:** Динамический из `GITHUB_REPOSITORY` (`/pendrops/` для продакшена).

---

## 📱 PWA

| Файл | Назначение |
|------|------------|
| `public/manifest.json` | Иконки, Share Target, File Handlers, категории |
| `public/icons/` | `icon.svg`, `icon-192.png`, `icon-512.png` |
| `public/xlsx.full.min.js` | SheetJS (ленивая загрузка 881 KB) |
| `public/data/version.json` | Fallback версия для SW (если вернётся) |

**Service Worker:** ❌ Удалён (был сломан). Supabase Realtime заменяет необходимость в SW для обновлений.

---

## 🔐 Безопасность

- **PIN хеш:** Только на сервере (Edge Function), соль `pendrops-salt-2026`
- **RLS:** Read для anon, Write для admin через Edge Function (service_role)
- **Ключи:** Только `VITE_SUPABASE_ANON_KEY` в бандле. Service Role Key — только в Edge Function / CI.
- **Коммиты:** Подписанные (`git commit -sS`)

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

## ⚠️ Известные проблемы

| Проблема | Статус | Решение |
|----------|--------|---------|
| RLS write policies | ❌ Не применены | Запустить `scripts/fix-rls.sql` в Supabase SQL Editor |
| Lint timeout | ⚠️ Зависает | Требует расследования `eslint . --fix && prettier --write .` |
| Browser cache | ⚠️ Устаревший UI | Бамп версии в `vite.config.js` (`__APP_VERSION__`) |
| Service Worker | ❌ Удалён | Сломан; Supabase Realtime заменяет |

---

## 📄 Лицензия

MIT — свободное использование, модификация, распространение.

---

**PenDrops** — сделано с ❤️ для студентов медколледжа.
