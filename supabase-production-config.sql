-- PenDrops Supabase Production Configuration
-- Run this in Supabase SQL Editor (Project → SQL Editor → New Query)
-- AFTER running the base schema (supabase-schema.sql)

-- ============================================================
-- 1. FIX RLS POLICIES - Remove anon WRITE, keep only SELECT
-- ============================================================

-- Drop the insecure anon write policies (added as temporary fix)
DROP POLICY IF EXISTS "Allow anon write lessons" ON public.lessons;
DROP POLICY IF EXISTS "Allow anon update lessons" ON public.lessons;
DROP POLICY IF EXISTS "Allow anon delete lessons" ON public.lessons;
DROP POLICY IF EXISTS "Allow anon write schedule_version" ON public.schedule_version;

-- Verify anon has ONLY SELECT
-- (These should already exist from base schema)
-- CREATE POLICY "Allow anon read schedule_version" ON schedule_version FOR SELECT TO anon USING (true);
-- CREATE POLICY "Allow anon read lessons" ON lessons FOR SELECT TO anon USING (true);

-- Admin writes via service_role (Edge Function) - already in base schema
-- CREATE POLICY "Allow service_role all schedule_version" ON schedule_version FOR ALL TO service_role USING (true) WITH CHECK (true);
-- CREATE POLICY "Allow service_role all lessons" ON lessons FOR ALL TO service_role USING (true) WITH CHECK (true);
-- CREATE POLICY "Allow service_role all admin_config" ON admin_config FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Verify final policies
SELECT tablename, policyname, cmd, roles, qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('lessons', 'schedule_version', 'admin_config')
ORDER BY tablename, policyname;

-- ============================================================
-- 2. CONFIGURE CORS FOR PRODUCTION DOMAIN
-- ============================================================

-- Note: CORS is configured in Supabase Dashboard → Settings → API → CORS
-- Add your production domain(s):
-- https://telikuy070-collab.github.io
-- https://your-custom-domain.com (if using custom domain)
-- http://localhost:8080 (for local development)

-- ============================================================
-- 3. CONFIGURE REALTIME - Enable only needed tables
-- ============================================================

-- Already in base schema:
-- ALTER PUBLICATION supabase_realtime ADD TABLE lessons;
-- ALTER PUBLICATION supabase_realtime ADD TABLE schedule_version;

-- Verify realtime publication
SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';

-- ============================================================
-- 4. ENABLE BACKUPS AND POINT-IN-TIME RECOVERY (PITR)
-- ============================================================

-- PITR is enabled automatically on Supabase Pro plan+
-- For Free tier: manual backups via pg_dump or Supabase Dashboard
-- To enable PITR (requires Pro plan):
-- 1. Go to Supabase Dashboard → Settings → Database → Backups
-- 2. Enable "Point in Time Recovery"
-- 3. Set retention period (7-30 days recommended)

-- ============================================================
-- 5. SECURITY HARDENING
-- ============================================================

-- Ensure RLS is enabled on all tables
ALTER TABLE public.lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedule_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_config ENABLE ROW LEVEL SECURITY;

-- Revoke all permissions from anon except SELECT
REVOKE ALL ON public.lessons FROM anon;
REVOKE ALL ON public.schedule_version FROM anon;
REVOKE ALL ON public.admin_config FROM anon;
GRANT SELECT ON public.lessons TO anon;
GRANT SELECT ON public.schedule_version TO anon;
-- NO GRANT on admin_config for anon

-- Service role has full access (for Edge Functions)
GRANT ALL ON public.lessons TO service_role;
GRANT ALL ON public.schedule_version TO service_role;
GRANT ALL ON public.admin_config TO service_role;

-- ============================================================
-- 6. ADMIN PIN - CHANGE FROM DEFAULT
-- ============================================================

-- Default PIN is 6137 (hash: a8f5f167f44f4964e6c998dee827110c)
-- CHANGE THIS IN PRODUCTION!
-- Generate new hash: echo -n 'YOUR_NEW_PINpendrops-salt-2026' | sha256sum
UPDATE public.admin_config
SET pin_hash = 'YOUR_NEW_SHA256_HASH_HERE',
    updated_at = NOW()
WHERE key = 'admin_pin';

-- ============================================================
-- 7. INDEXES FOR PERFORMANCE
-- ============================================================

-- Already in base schema:
-- CREATE INDEX IF NOT EXISTS idx_lessons_sheet_day ON lessons(sheet_id, day_order);
-- CREATE INDEX IF NOT EXISTS idx_lessons_group ON lessons(group_code);
-- CREATE INDEX IF NOT EXISTS idx_lessons_sheet_group ON lessons(sheet_id, group_code);

-- Additional indexes for common queries
CREATE INDEX IF NOT EXISTS idx_lessons_day_order_time ON lessons(day_order, time);
CREATE INDEX IF NOT EXISTS idx_lessons_sheet_group_day ON lessons(sheet_id, group_code, day_order);

-- ============================================================
-- 8. VERIFY CONFIGURATION
-- ============================================================

-- Check RLS status
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public' AND tablename IN ('lessons', 'schedule_version', 'admin_config');

-- Check policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

-- Check realtime
SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';

-- Check admin config
SELECT * FROM public.admin_config;