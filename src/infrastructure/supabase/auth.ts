/**
 * PIN-based Auth Provider - Simple admin verification
 * Uses Supabase Edge Function for secure PIN verification (hash never leaves server)
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { IAuthProvider } from '@core/domain/repositories/ports';
import { getSupabaseClient } from './client';

export class SupabaseAuthProvider implements IAuthProvider {
  private client: SupabaseClient;
  private adminVerified = false;
  private verifying = false; // guard against concurrent verification requests

  constructor() {
    this.client = getSupabaseClient();
  }

  async verifyPin(pin: string): Promise<boolean> {
    // Guard: prevent concurrent verification requests
    if (this.verifying) return false;
    this.verifying = true;

    try {
      const { data, error } = await this.client.functions.invoke('verify-pin', {
        body: { pin },
      });

      if (error) {
        console.error('[auth] verify-pin failed:', error);
        return false;
      }

      const valid = data?.valid === true;
      if (valid) this.adminVerified = true;
      return valid;

    } catch (err) {
      console.error('[auth] verifyPin error:', err);
      return false;
    } finally {
      this.verifying = false;
    }
  }

  isAdmin(): boolean {
    return this.adminVerified;
  }

  async getSession() {
    // Not using Supabase Auth, but return admin status
    return this.adminVerified
      ? { user: { id: 'admin', role: 'admin' }, accessToken: 'pin-verified' }
      : null;
  }
}