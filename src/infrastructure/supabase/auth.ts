/**
 * PIN-based Auth Provider - Simple admin verification
 * Uses Supabase Edge Function for secure PIN verification (hash never leaves server)
 * Edge Function verify-pin now uses Argon2id (with legacy SHA-256 fallback during migration)
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

  /**
   * Hash a PIN using Argon2id for storage in admin_config.
   * This should be called from a secure server-side context (Edge Function),
   * not from the client. Exported for use in admin PIN management functions.
   *
   * @param pin - The plain text PIN to hash
   * @returns Argon2id hash string (includes algorithm, params, salt, and hash)
   */
  static async hashPin(pin: string): Promise<string> {
    // This method should only be called from Edge Function (Deno runtime)
    // In browser, it will throw - use Edge Function for PIN hashing
    if (typeof window !== 'undefined') {
      throw new Error('hashPin() can only be called from Edge Function (Deno runtime)');
    }
    // Dynamic import for Argon2id (only available in Deno/Edge runtime)
    // @ts-ignore - Deno-only module, not available in browser
    const { hash } = await import('https://deno.land/x/argon2@0.4.0/mod.ts');
    return hash(pin, {
      memoryCost: 19456,  // 19 MB
      timeCost: 2,        // 2 iterations
      parallelism: 1,
      type: 'argon2id',
    });
  }

  /**
   * Update admin PIN in database.
   * Creates Argon2id hash and stores it with algorithm identifier.
   * Requires service_role key (call from Edge Function or admin script).
   */
  static async updateAdminPin(supabase: SupabaseClient, newPin: string): Promise<void> {
    const pinHash = await this.hashPin(newPin);
    const { error } = await supabase
      .from('admin_config')
      .update({
        pin_hash: pinHash,
        pin_hash_algorithm: 'argon2id',
        updated_at: new Date().toISOString(),
      })
      .eq('key', 'admin_pin');

    if (error) {
      throw new Error(`Failed to update admin PIN: ${error.message}`);
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