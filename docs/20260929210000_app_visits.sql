-- app_visits — анонимный счётчик устройств для блока «Пользователи» в админке.
--
-- ЧТО СОЗДАЁТ
--   Одну таблицу public.app_visits — реестр устройств, которые открывали PWA.
--   Больше ничего: ни функций, ни триггеров, ни изменений в существующих
--   таблицах.
--
-- ЗАЧЕМ
--   В админке есть три разных вопроса о «пользователях», и только на два из них
--   есть честный ответ:
--     * «Сейчас онлайн» — точный и в реальном времени, из Realtime Presence,
--       без этой таблицы вообще;
--     * «устройств за 7 дней / 30 дней / всего» — берётся отсюда;
--     * «сколько учеников реально учатся» — не считается: у приложения нет
--       аккаунтов, и таблица этого не меняет.
--   Без таблицы приложение работает ровно как раньше: блок «Пользователи»
--   показывает «статистика за период требует установки таблицы», ничего не
--   ломается и ничего лишнего в консоли не появляется.
--
-- ЧТО СОДЕРЖИТ
--   ТОЛЬКО анонимный идентификатор устройства (device_id — случайный UUID из
--   localStorage, никак не связанный с человеком) и даты первого и последнего
--   открытия приложения. Ни имён, ни групп, ни номеров телефонов, ни IP, ни
--   никаких других персональных данных. Строка на устройство, а не на
--   открытие: каждый запуск лишь двигает last_seen_at.
--
-- ПРИМЕНЕНИЕ
--   Выполните файл целиком в Supabase → SQL Editor (или через CLI).
--   Повторный запуск безопасен: create table/index if not exists и drop policy
--   if exists перед create policy.
--
-- ОТКАТ
--   drop table if exists public.app_visits;
--
-- RLS
--   Политики даны той же анонимной роли, что и остальной проект, и касаются
--   только этой таблицы — существующую работу они не затрагивают. Читать может
--   аноним (админка считает цифры), писать может аноним (одна строка на своё
--   устройство: upsert по device_id).

create table if not exists public.app_visits (
  -- Случайный UUID из localStorage устройства. Персональных данных не несёт.
  device_id     uuid        primary key,
  -- Когда устройство открыло приложение впервые.
  first_seen_at timestamptz not null default now(),
  -- Когда оно открывало приложение в последний раз; двигается при каждом входе.
  last_seen_at  timestamptz not null default now()
);

comment on table public.app_visits is
  'Анонимные идентификаторы устройств и даты открытия PWA. Персональных данных не содержит.';

-- Счётчики «за 7 дней» и «за 30 дней» сортируют/фильтруют по last_seen_at.
create index if not exists app_visits_last_seen_at_idx
  on public.app_visits (last_seen_at desc);

alter table public.app_visits enable row level security;

-- Чтение: блок «Пользователи» в админке.
drop policy if exists "app_visits anon select" on public.app_visits;
create policy "app_visits anon select"
  on public.app_visits for select to anon using (true);

-- Запись: устройство обновляет только свою строку.
drop policy if exists "app_visits anon insert" on public.app_visits;
create policy "app_visits anon insert"
  on public.app_visits for insert to anon with check (true);

drop policy if exists "app_visits anon update" on public.app_visits;
create policy "app_visits anon update"
  on public.app_visits for update to anon using (true) with check (true);
