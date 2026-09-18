-- Migration: Add Argon2id PIN hashing support
-- Adds algorithm column and migrates from SHA-256 to Argon2id

-- Add column for hash algorithm
ALTER TABLE admin_config ADD COLUMN IF NOT EXISTS pin_hash_algorithm text DEFAULT 'argon2id';

-- Note: The existing PIN hash uses SHA-256 with salt 'pendrops-salt-2026'
-- To migrate to Argon2id, the admin must set a new PIN via the admin panel
-- or run the following SQL with a new Argon2id hash:
--
-- UPDATE admin_config
-- SET pin_hash = '$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>',
--     pin_hash_algorithm = 'argon2id',
--     updated_at = now()
-- WHERE key = 'admin_pin';
--
-- Generate the hash using the hash-pin Edge Function or:
-- deno run -A https://deno.land/x/argon2@0.4.0/cli.ts hash "new-pin" --memory-cost 19456 --time-cost 2 --parallelism 1

-- Verify current state
SELECT key, pin_hash, pin_hash_algorithm, updated_at FROM admin_config WHERE key = 'admin_pin';