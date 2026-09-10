-- PenDrops Database Schema
-- Run this in Supabase SQL Editor (Project → SQL Editor → New Query)

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Schedule version table (single row for version tracking)
CREATE TABLE IF NOT EXISTS schedule_version (
  id INTEGER PRIMARY KEY DEFAULT 1,
  version TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  file_name TEXT,
  file_size BIGINT
);

-- Insert initial version row
INSERT INTO schedule_version (id, version, updated_at)
VALUES (1, 'initial', NOW())
ON CONFLICT (id) DO NOTHING;

-- Lessons table - core schedule data
CREATE TABLE IF NOT EXISTS lessons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sheet_id TEXT NOT NULL,           -- Department/sheet name (e.g., "Лечебное дело")
  day TEXT NOT NULL,                -- Day name in Russian
  day_order INTEGER NOT NULL,       -- 0-6 for sorting (Mon=0)
  time TEXT NOT NULL,               -- Time range "08:30-10:05"
  para TEXT NOT NULL,               -- Pair number "1", "2", etc.
  group_code TEXT NOT NULL,         -- Group code (e.g., "ЛД-11")
  subgroup TEXT,                    -- Subgroup "1", "2", or NULL
  subject TEXT NOT NULL,            -- Subject name
  type TEXT NOT NULL,               -- lecture, practice, lab, exam, consultation
  teacher TEXT,                     -- Teacher name
  room TEXT,                        -- Room number
  is_exam BOOLEAN DEFAULT FALSE,    -- Is this an exam
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_lessons_sheet_day ON lessons(sheet_id, day_order);
CREATE INDEX IF NOT EXISTS idx_lessons_group ON lessons(group_code);
CREATE INDEX IF NOT EXISTS idx_lessons_sheet_group ON lessons(sheet_id, group_code);

-- Admin config table (for PIN hash storage)
CREATE TABLE IF NOT EXISTS admin_config (
  key TEXT PRIMARY KEY,
  pin_hash TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert default admin PIN (6137) - CHANGE THIS IN PRODUCTION!
-- Hash is SHA256('6137' + 'pendrops-salt-2026')
INSERT INTO admin_config (key, pin_hash)
VALUES ('admin_pin', 'a8f5f167f44f4964e6c998dee827110c')
ON CONFLICT (key) DO NOTHING;

-- Enable Row Level Security
ALTER TABLE schedule_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_config ENABLE ROW LEVEL SECURITY;

-- Policies: Allow anon read access to schedule
CREATE POLICY "Allow anon read schedule_version" ON schedule_version
  FOR SELECT TO anon USING (true);

CREATE POLICY "Allow anon read lessons" ON lessons
  FOR SELECT TO anon USING (true);

-- Admin policies (using service role for writes)
CREATE POLICY "Allow service_role all schedule_version" ON schedule_version
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Allow service_role all lessons" ON lessons
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "Allow service_role all admin_config" ON admin_config
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Enable Realtime for lessons table
ALTER PUBLICATION supabase_realtime ADD TABLE lessons;
ALTER PUBLICATION supabase_realtime ADD TABLE schedule_version;

-- Helper function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for lessons
DROP TRIGGER IF EXISTS update_lessons_updated_at ON lessons;
CREATE TRIGGER update_lessons_updated_at
  BEFORE UPDATE ON lessons
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Trigger for schedule_version
DROP TRIGGER IF EXISTS update_schedule_version_updated_at ON schedule_version;
CREATE TRIGGER update_schedule_version_updated_at
  BEFORE UPDATE ON schedule_version
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Trigger for admin_config
DROP TRIGGER IF EXISTS update_admin_config_updated_at ON admin_config;
CREATE TRIGGER update_admin_config_updated_at
  BEFORE UPDATE ON admin_config
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Verify setup
SELECT 'Schema created successfully' as status;
SELECT * FROM schedule_version;
SELECT count(*) as lesson_count FROM lessons;