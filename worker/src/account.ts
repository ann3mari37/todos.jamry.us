// The MaLinda Perry cockpit's Settings → Account: change the sign-in email right away, with no confirmation email.
// The same account signs in to the cockpit, Tasks (web and phone) and opens Links, so the change applies everywhere.
// Because nothing is emailed, the account's current password is checked first, and only the cockpit's owner
// (listed by account ID, which doesn't change with the email) can do this.

import { z } from 'zod';
import type { Env } from './env';
import { isOwnerId } from './links';
import { HttpError, serviceClient } from './supabase';

export const EmailInput = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(200),
});

export interface AccountDeps {
  /** True when this email and password sign in. */
  checkPassword(env: Env, email: string, password: string): Promise<boolean>;
  /** Sets the account's email, already confirmed. 'taken' when another account has it. */
  setEmail(env: Env, userId: string, email: string): Promise<'ok' | 'taken'>;
}

const supabaseDeps: AccountDeps = {
  async checkPassword(env, email, password) {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    return res.ok;
  },
  async setEmail(env, userId, email) {
    const { error } = await serviceClient(env).auth.admin.updateUserById(userId, { email, email_confirm: true });
    if (!error) return 'ok';
    if ((error as { code?: string }).code === 'email_exists' || /already|registered|exists/i.test(error.message)) return 'taken';
    throw new HttpError(502, 'email_change_failed');
  },
};

/** POST /api/account/email */
export async function changeEmail(env: Env, c: { userId: string; email: string | null }, input: z.infer<typeof EmailInput>, deps: AccountDeps = supabaseDeps) {
  // Without her ID on file, Links would stop recognizing her once the email changes, so that comes first.
  if (!isOwnerId(env, c.userId)) throw new HttpError(409, 'owner_id_not_set');
  if (!c.email) throw new HttpError(400, 'no_current_email');
  if (input.email === c.email.toLowerCase()) return { email: c.email, changed: false };
  if (!(await deps.checkPassword(env, c.email, input.password))) throw new HttpError(403, 'wrong_password');
  if ((await deps.setEmail(env, c.userId, input.email)) === 'taken') throw new HttpError(409, 'email_taken');
  return { email: input.email, changed: true };
}
