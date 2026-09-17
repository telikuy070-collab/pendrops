/**
 * Supabase Client - Singleton factory for browser-safe client
 * Uses anon key only (never service role in browser)
 * Configuration is runtime-safe and allows fallback to defaults
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseConfig, validateConfig } from './config';

let clientInstance: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (clientInstance) return clientInstance;

  if (!validateConfig()) {
    throw new Error('Invalid Supabase configuration');
  }

  const { url, anonKey } = supabaseConfig;

  clientInstance = createClient(url, anonKey, {
    auth: {
      persistSession: false, // We handle auth via PIN, not Supabase Auth
      autoRefreshToken: false,
    },
    realtime: {
      params: { eventsPerSecond: 10 },
    },
  });

  console.log('[Supabase] Client initialized:', url);
  return clientInstance;
}


export function resetSupabaseClient(): void {
  clientInstance = null;
}

