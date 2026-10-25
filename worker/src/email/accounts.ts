// Connecting mailboxes: OAuth (Gmail, Outlook) and IMAP app passwords. Credentials are encrypted at rest and only
// ever read with the service role; users see the non-secret email_accounts row through RLS.

import { decrypt, encrypt, signState, verifyState } from '../crypto';
import type { Env } from '../env';
import { HttpError, serviceClient } from '../supabase';
import { GmailProvider } from './gmail';
import { ImapProvider } from './imap';
import { OutlookProvider } from './outlook';
import { ProviderError, type MailProvider, type ProviderKind } from './types';

const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const MS_AUTH = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const MS_TOKEN = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const GOOGLE_SCOPES = 'openid email https://www.googleapis.com/auth/gmail.modify';
const MS_SCOPES = 'offline_access openid email User.Read Mail.ReadWrite';

export const ACCOUNT_COLORS = ['#47A9A6', '#EE6B85', '#F2B84B', '#A98BDB', '#86B868', '#F59A6B', '#6C9BD2'];

const appUrl = (env: Env) => env.APP_URL ?? 'https://todos.jamry.us';
export const redirectUri = (env: Env) => `${env.API_URL ?? appUrl(env)}/api/email/oauth/callback`;

function oauthConfig(env: Env, p: 'gmail' | 'outlook') {
  const c = p === 'gmail'
    ? { id: env.GOOGLE_CLIENT_ID, secret: env.GOOGLE_CLIENT_SECRET, auth: GOOGLE_AUTH, token: GOOGLE_TOKEN, scopes: GOOGLE_SCOPES }
    : { id: env.MS_CLIENT_ID, secret: env.MS_CLIENT_SECRET, auth: MS_AUTH, token: MS_TOKEN, scopes: MS_SCOPES };
  if (!c.id || !c.secret) throw new HttpError(503, `${p}_not_configured`);
  return c;
}

/** Which providers this deployment can connect (shown in the app's "Add account" sheet). */
export function availableProviders(env: Env) {
  const key = !!env.EMAIL_TOKEN_KEY;
  return {
    gmail: key && !!env.GOOGLE_CLIENT_ID && !!env.GOOGLE_CLIENT_SECRET,
    outlook: key && !!env.MS_CLIENT_ID && !!env.MS_CLIENT_SECRET,
    imap: key,
  };
}

export async function startOAuth(env: Env, userId: string, provider: 'gmail' | 'outlook', returnTo?: string) {
  const c = oauthConfig(env, provider);
  const state = await signState(env.EMAIL_TOKEN_KEY, { u: userId, p: provider, r: returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/email-accounts' });
  const q = new URLSearchParams({
    client_id: c.id!, redirect_uri: redirectUri(env), response_type: 'code', scope: c.scopes, state,
    ...(provider === 'gmail' ? { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' } : { response_mode: 'query', prompt: 'select_account' }),
  });
  return { url: `${c.auth}?${q}` };
}

interface TokenResponse { access_token: string; refresh_token?: string; expires_in: number; error?: string }

async function tokenRequest(env: Env, p: 'gmail' | 'outlook', body: Record<string, string>): Promise<TokenResponse> {
  const c = oauthConfig(env, p);
  const res = await fetch(c.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.id!, client_secret: c.secret!, ...(p === 'outlook' ? { scope: c.scopes } : {}), ...body }),
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !json.access_token) {
    if (json.error === 'invalid_grant') throw new ProviderError('needs_reauth', 'invalid_grant');
    throw new ProviderError('provider_error', `token_${res.status}`);
  }
  return json;
}

async function mailboxAddress(p: 'gmail' | 'outlook', token: string): Promise<{ address: string; name: string | null }> {
  if (p === 'gmail') {
    const r = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new ProviderError('provider_error', `gmail_profile_${r.status}`);
    const j = (await r.json()) as { emailAddress: string };
    return { address: j.emailAddress.toLowerCase(), name: null };
  }
  const r = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName', { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new ProviderError('provider_error', `graph_profile_${r.status}`);
  const j = (await r.json()) as { mail: string | null; userPrincipalName: string; displayName: string | null };
  return { address: (j.mail ?? j.userPrincipalName).toLowerCase(), name: j.displayName };
}

async function saveAccount(env: Env, userId: string, row: { provider: ProviderKind; email_address: string; display_name: string | null }, creds: Record<string, unknown>) {
  const db = serviceClient(env);
  const { data: existing } = await db.from('email_accounts').select('id').eq('user_id', userId).eq('provider', row.provider).eq('email_address', row.email_address).maybeSingle();
  let data: { id: string } | null = existing;
  if (existing) {
    // Reconnecting keeps the user's color, area and digest choices.
    await db.from('email_accounts').update({ status: 'active', error_code: null, ...(row.display_name ? { display_name: row.display_name } : {}) }).eq('id', existing.id);
  } else {
    const { count } = await db.from('email_accounts').select('id', { count: 'exact', head: true }).eq('user_id', userId);
    const ins = await db.from('email_accounts')
      .insert({ user_id: userId, ...row, color: ACCOUNT_COLORS[(count ?? 0) % ACCOUNT_COLORS.length] })
      .select('id').single();
    data = ins.data;
  }
  if (!data) throw new HttpError(500, 'account_save_failed');
  const { error: e2 } = await db.from('email_credentials').upsert({ account_id: data.id, user_id: userId, ...creds, updated_at: new Date().toISOString() });
  if (e2) throw new HttpError(500, 'account_save_failed');
  return data.id as string;
}

/** GET /api/email/oauth/callback — the browser lands here from Google/Microsoft; we redirect back into the app. */
export async function finishOAuth(env: Env, url: URL): Promise<Response> {
  // The return path may carry its own query (e.g. /onboarding?step=email).
  const back = (path: string, params: Record<string, string>) => Response.redirect(`${appUrl(env)}${path}${path.includes('?') ? '&' : '?'}${new URLSearchParams(params)}`, 302);
  let returnTo = '/email-accounts';
  try {
    const state = await verifyState(env.EMAIL_TOKEN_KEY, url.searchParams.get('state') ?? '');
    returnTo = state.r;
    if (url.searchParams.get('error')) return back(returnTo, { email_error: 'access_denied' });
    const code = url.searchParams.get('code');
    if (!code) return back(returnTo, { email_error: 'missing_code' });
    const tok = await tokenRequest(env, state.p, { code, grant_type: 'authorization_code', redirect_uri: redirectUri(env) });
    if (!tok.refresh_token) return back(returnTo, { email_error: 'no_offline_access' });
    const who = await mailboxAddress(state.p, tok.access_token);
    await saveAccount(env, state.u, { provider: state.p, email_address: who.address, display_name: who.name }, {
      access_token_enc: await encrypt(env.EMAIL_TOKEN_KEY, tok.access_token),
      refresh_token_enc: await encrypt(env.EMAIL_TOKEN_KEY, tok.refresh_token),
      access_expires_at: new Date(Date.now() + (tok.expires_in - 60) * 1000).toISOString(),
    });
    return back(returnTo, { connected: state.p });
  } catch (e) {
    const code = e instanceof HttpError || e instanceof ProviderError ? e.code : 'connect_failed';
    console.warn('oauth callback failed', { code });
    return back(returnTo, { email_error: code });
  }
}

export interface ImapInput { email: string; host: string; port: number; username: string; password: string; archive_folder?: string }

/** Validates IMAP settings by logging in before anything is stored. */
export async function connectImap(env: Env, userId: string, input: ImapInput) {
  if (!env.EMAIL_TOKEN_KEY) throw new HttpError(503, 'email_not_configured');
  const provider = new ImapProvider({ host: input.host, port: input.port, username: input.username, password: input.password, archiveFolder: input.archive_folder ?? 'Archive' });
  try {
    await provider.open();
  } catch (e) {
    throw new HttpError(400, e instanceof ProviderError && e.code === 'needs_reauth' ? 'imap_login_failed' : 'imap_unreachable');
  } finally {
    await provider.close();
  }
  const id = await saveAccount(env, userId, { provider: 'imap', email_address: input.email.toLowerCase(), display_name: null }, {
    imap_host: input.host, imap_port: input.port, imap_username: input.username,
    imap_password_enc: await encrypt(env.EMAIL_TOKEN_KEY, input.password), imap_archive_folder: input.archive_folder ?? 'Archive',
  });
  return { id };
}

interface CredRow {
  account_id: string; access_token_enc: string | null; refresh_token_enc: string | null; access_expires_at: string | null;
  imap_host: string | null; imap_port: number | null; imap_username: string | null; imap_password_enc: string | null; imap_archive_folder: string | null;
}

export async function markAccount(env: Env, accountId: string, status: 'active' | 'needs_reauth' | 'error', error_code: string | null = null) {
  await serviceClient(env).from('email_accounts').update({ status, error_code }).eq('id', accountId);
}

/** A ready-to-use provider for an account, refreshing (and rotating) OAuth tokens as needed. */
export async function providerFor(env: Env, account: { id: string; provider: ProviderKind }): Promise<MailProvider> {
  const db = serviceClient(env);
  const { data } = await db.from('email_credentials').select('*').eq('account_id', account.id).maybeSingle();
  const cred = data as CredRow | null;
  if (!cred) throw new ProviderError('needs_reauth', 'no_credentials');

  if (account.provider === 'imap') {
    return new ImapProvider({
      host: cred.imap_host!, port: cred.imap_port ?? 993, username: cred.imap_username!,
      password: await decrypt(env.EMAIL_TOKEN_KEY, cred.imap_password_enc!), archiveFolder: cred.imap_archive_folder ?? 'Archive',
    });
  }

  let token = cred.access_token_enc ? await decrypt(env.EMAIL_TOKEN_KEY, cred.access_token_enc) : '';
  if (!token || !cred.access_expires_at || new Date(cred.access_expires_at).getTime() < Date.now() + 30_000) {
    try {
      const refresh = await decrypt(env.EMAIL_TOKEN_KEY, cred.refresh_token_enc!);
      const tok = await tokenRequest(env, account.provider, { refresh_token: refresh, grant_type: 'refresh_token' });
      token = tok.access_token;
      await db.from('email_credentials').update({
        access_token_enc: await encrypt(env.EMAIL_TOKEN_KEY, token),
        // Microsoft rotates refresh tokens; Google usually doesn't return a new one.
        ...(tok.refresh_token ? { refresh_token_enc: await encrypt(env.EMAIL_TOKEN_KEY, tok.refresh_token) } : {}),
        access_expires_at: new Date(Date.now() + (tok.expires_in - 60) * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('account_id', account.id);
    } catch (e) {
      if (e instanceof ProviderError && e.code === 'needs_reauth') await markAccount(env, account.id, 'needs_reauth', 'token_revoked');
      throw e;
    }
  }
  return account.provider === 'gmail' ? new GmailProvider(token) : new OutlookProvider(token);
}

/** Best-effort token revocation, then delete the account (credentials and messages cascade). */
export async function disconnect(env: Env, account: { id: string; provider: ProviderKind }) {
  const db = serviceClient(env);
  try {
    const { data } = await db.from('email_credentials').select('refresh_token_enc').eq('account_id', account.id).maybeSingle();
    if (account.provider === 'gmail' && data?.refresh_token_enc) {
      const t = await decrypt(env.EMAIL_TOKEN_KEY, data.refresh_token_enc);
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t)}`, { method: 'POST' });
    }
    // Microsoft has no per-token revocation endpoint for delegated tokens; deleting our copy ends our access.
  } catch { /* revocation is best effort */ }
  await db.from('email_accounts').delete().eq('id', account.id);
}
