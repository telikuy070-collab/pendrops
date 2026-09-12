-- Fix RLS policies for admin publishing
-- Allow anon to write to lessons and schedule_version for admin publishing

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Allow anon write lessons" ON public.lessons;
DROP POLICY IF EXISTS "Allow anon update lessons" ON public.lessons;
DROP POLICY IF EXISTS "Allow anon delete lessons" ON public.lessons;
DROP POLICY IF EXISTS "Allow anon write schedule_version" ON public.schedule_version;

-- Create new policies for anon write access (for admin publishing)
CREATE POLICY "Allow anon write lessons"
ON public.lessons FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Allow anon update lessons"
ON public.lessons FOR UPDATE TO anon USING (true) WITH CHECK (true);

CREATE POLICY "Allow anon delete lessons"
ON public.lessons FOR DELETE TO anon USING (true);

CREATE POLICY "Allow anon write schedule_version"
ON public.schedule_version FOR ALL TO anon USING (true) WITH CHECK (true);

-- Verify policies
SELECT tablename, policyname, cmd, roles, qual
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('lessons', 'schedule_version');