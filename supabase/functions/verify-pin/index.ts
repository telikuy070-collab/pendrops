import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verify } from 'https://deno.land/x/argon2@0.4.0/mod.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://telikuy070-collab.github.io',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
};

const attempts = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = attempts.get(ip);
  if (!record || now > record.resetAt) {
    attempts.set(ip, { count: 1, resetAt: Date.now() + 60000 });
    return true;
  }
  if (record.count >= 5) return false;
  record.count++;
  return true;
}

serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  const ip = req.headers.get('x-forwarded-for') || 'unknown';
  if (!checkRateLimit(ip)) {
    return new Response(JSON.stringify({ error: 'Too many attempts' }), {
      status: 429,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { pin } = await req.json();

    if (!pin || typeof pin !== 'string') {
      return new Response(JSON.stringify({ valid: false, error: 'PIN required' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // Service role — обходит RLS, читает admin_config
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data, error } = await supabase
      .from('admin_config')
      .select('pin_hash, pin_hash_algorithm')
      .eq('key', 'admin_pin')
      .single();

    if (error || !data) {
      // Fallback на env, если в БД ничего нет
      const envPinHash = Deno.env.get('ADMIN_PIN_HASH');
      if (!envPinHash) {
        return new Response(JSON.stringify({ valid: false }), {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }
      // Legacy SHA-256 fallback for env var
      const encoder = new TextEncoder();
      const inputData = encoder.encode(pin + 'pendrops-salt-2026');
      const hashBuffer = await crypto.subtle.digest('SHA-256', inputData);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const inputHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      return new Response(JSON.stringify({ valid: inputHash === envPinHash }), {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    const storedHash = data.pin_hash;
    const algorithm = data.pin_hash_algorithm || 'argon2id';

    let valid = false;

    if (algorithm === 'argon2id' && storedHash.startsWith('$argon2id$')) {
      // Argon2id verification
      try {
        valid = await verify(storedHash, pin);
      } catch (err) {
        console.error('[verify-pin] Argon2id verify failed:', err);
        valid = false;
      }
    } else if (storedHash.length === 64 && /^[0-9a-f]{64}$/.test(storedHash)) {
      // Legacy SHA-256 verification (for migration period)
      const encoder = new TextEncoder();
      const inputData = encoder.encode(pin + 'pendrops-salt-2026');
      const hashBuffer = await crypto.subtle.digest('SHA-256', inputData);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const inputHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      valid = inputHash === storedHash;
    }

    return new Response(JSON.stringify({ valid }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    return new Response(JSON.stringify({ valid: false, error: String(err) }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
});