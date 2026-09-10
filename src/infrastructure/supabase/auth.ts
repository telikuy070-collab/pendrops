/**
 * PIN-based Auth Provider - Simple admin verification
 * Uses Supabase for secure PIN storage (hashed)
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { IAuthProvider } from '@core/domain/repositories/ports';
import { getSupabaseClient } from './client';

export class SupabaseAuthProvider implements IAuthProvider {
  private client: SupabaseClient;
  private adminVerified = false;
  private pinHash: string | null = null;

  constructor() {
    this.client = getSupabaseClient();
  }

  async verifyPin(pin: string): Promise<boolean> {
    // Load PIN hash from database (secure, not in client code)
    if (!this.pinHash) {
      const { data, error } = await this.client
        .from('admin_config')
        .select('pin_hash')
        .eq('key', 'admin_pin')
        .single();

      if (error || !data) {
        // Fallback to env for development
        const envPin = import.meta.env.VITE_ADMIN_PIN;
        this.pinHash = envPin ? await this.hashPin(envPin) : null;
      } else {
        this.pinHash = data.pin_hash;
      }
    }

    if (!this.pinHash) return false;

    const inputHash = await this.hashPin(pin);
    const valid = inputHash === this.pinHash;
    
    if (valid) this.adminVerified = true;
    return valid;
  }

  isAdmin(): boolean {
    return this.adminVerified;
  }

  async getSession() {
    // Not using Supabase Auth, but return admin status
    return this.adminVerified ? { user: { id: 'admin', role: 'admin' }, accessToken: 'pin-verified' } : null;
  }

  private async hashPin(pin: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(pin + 'pendrops-salt-2026');
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
}