/**
 * Supabase Configuration - Runtime-safe
 * 
 * Reads from build-time env vars (VITE_*), falls back to hardcoded defaults.
 * Allows override via window object for testing/custom deployments.
 */

function getEnv(key: string, fallback?: string): string {
  // Try import.meta.env (build-time, Vite browser context)
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    const value = (import.meta.env as Record<string, string | undefined>)[key];
    if (value) return value;
  }

  // Try window override (for custom deployments / testing)
  if (typeof window !== 'undefined' && (window as any).__pendrops_config) {
    const value = (window as any).__pendrops_config[key];
    if (value) return value;
  }

  return fallback || '';
}

export const supabaseConfig = {
  url: getEnv('VITE_SUPABASE_URL', 'https://bnzcfhtmzvxxiwfkdryn.supabase.co'),
  anonKey: getEnv(
    'VITE_SUPABASE_ANON_KEY',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJuemNmaHRtenZ4eGl3ZmtkcnluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg3MTAzNzgsImV4cCI6MjEwNDI4NjM3OH0.aGrhaK5G7rM-p_bMDUZyGm-uvWSosvpe7GjfuWHXHX8'
  ),
};

export function validateConfig(): boolean {
  if (!supabaseConfig.url) {
    console.error('[Supabase] Missing VITE_SUPABASE_URL');
    return false;
  }
  if (!supabaseConfig.anonKey) {
    console.error('[Supabase] Missing VITE_SUPABASE_ANON_KEY');
    return false;
  }
  return true;
}
