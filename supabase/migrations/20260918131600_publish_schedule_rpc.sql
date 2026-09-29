-- Migration: Add publish_schedule RPC function for atomic admin publishing.
--
-- NOT USED BY THE CLIENT. The admin UI writes directly to PostgREST
-- (insert lessons -> delete stale lessons -> upsert schedule_version with
-- id = 1); the Edge Function publish-schedule calls this RPC and is a
-- fallback path only. Do not wire the client back to this function without
-- first applying it to the database and reloading the PostgREST schema cache.

CREATE OR REPLACE FUNCTION publish_schedule(
  p_lessons jsonb,
  p_version text,
  p_updated_at timestamptz
) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM lessons;
  INSERT INTO lessons (id, sheet_id, day, day_order, time, para, group_code, subgroup, subject, type, teacher, room, is_exam, created_at, updated_at)
  SELECT
    gen_random_uuid(),
    lesson->>'sheet_id',
    lesson->>'day',
    (lesson->>'day_order')::int,
    lesson->>'time',
    lesson->>'para',
    lesson->>'group_code',
    lesson->>'subgroup',
    lesson->>'subject',
    lesson->>'type',
    lesson->>'teacher',
    lesson->>'room',
    (lesson->>'is_exam')::bool,
    p_updated_at,
    p_updated_at
  FROM jsonb_array_elements(p_lessons) AS lesson;

  -- schedule_version has a single row pinned to id = 1. There is no unique
  -- index on `version`, so `ON CONFLICT (version)` always failed with 42P10
  -- ("there is no unique or exclusion constraint matching the ON CONFLICT
  -- specification") and rolled the whole transaction back.
  INSERT INTO schedule_version (id, version, updated_at) VALUES (1, p_version, p_updated_at)
  ON CONFLICT (id) DO UPDATE
    SET version = EXCLUDED.version, updated_at = EXCLUDED.updated_at;
END;
$$;

-- PostgREST caches the function list; without this the RPC stays invisible
-- (PGRST202) until the schema cache is reloaded.
NOTIFY pgrst, 'reload schema';
