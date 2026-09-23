-- Verify current realtime publication membership
SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';

-- Add tables (idempotent — IF NOT EXISTS not supported, use conditional DO block)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'lessons'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE lessons;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'schedule_version'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE schedule_version;
  END IF;
END $$;

-- Final verification
SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
