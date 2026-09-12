-- Update PIN hash for admin_pin to match Edge Function salt 'pendrops-salt-2026'
-- PIN: 6137
-- Hash: SHA256('6137' + 'pendrops-salt-2026')

UPDATE admin_config 
SET pin_hash = '0704d7bc79ee526aeca17741d7174920d53b399fd979fa0e7df466d48d640e2b',
    updated_at = now()
WHERE key = 'admin_pin';

-- Verify
SELECT key, pin_hash, updated_at FROM admin_config WHERE key = 'admin_pin';