import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { sharedSessionStorage, usesSharedSession } from './sharedSession';

// Public values only. The anon key is safe in clients because every table is protected by RLS.
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
export const isConfigured = !!SUPABASE_URL && !!SUPABASE_ANON_KEY;

// On *.malindaperryconsulting.com the session is shared with the cockpit through a domain cookie
// (see sharedSession.ts); everywhere else the web app keeps using localStorage.
const webStorage = () => {
  if (typeof window === 'undefined' || typeof document === 'undefined' || !usesSharedSession(window.location.hostname)) return undefined;
  const jar = { read: () => document.cookie, write: (c: string) => { document.cookie = c; } };
  let local: Storage | null = null;
  try { local = window.localStorage; } catch { local = null; }
  return sharedSessionStorage(jar, local);
};

export const supabase = createClient(SUPABASE_URL || 'https://not-configured.invalid', SUPABASE_ANON_KEY || 'missing', {
  auth: {
    storage: Platform.OS === 'web' ? webStorage() : AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
});
