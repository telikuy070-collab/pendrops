-- Migration: Add publish_schedule RPC function for secure admin publishing
-- This function is called by the publish-schedule Edge Function with service_role

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

  INSERT INTO schedule_version (version, updated_at) VALUES (p_version, p_updated_at)
  ON CONFLICT (version) DO UPDATE SET updated_at = p_updated_at;
END;
$$;