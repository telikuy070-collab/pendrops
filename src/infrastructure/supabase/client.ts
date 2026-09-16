/**
 * Supabase Client - Singleton factory for browser-safe client
 * Uses anon key only (never service role in browser)
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let clientInstance: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (clientInstance) return clientInstance;

  const url = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in environment');
  }

  clientInstance = createClient(url, anonKey, {
    auth: {
      persistSession: false, // We handle auth via PIN, not Supabase Auth
      autoRefreshToken: false,
    },
    realtime: {
      params: { eventsPerSecond: 10 },
    },
  });

  return clientInstance;
}

export function resetSupabaseClient(): void {
  clientInstance = null;
}
