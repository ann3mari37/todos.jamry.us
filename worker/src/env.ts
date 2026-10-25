export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string; // secret — used for ai_operations logging, cron, and mailbox credentials
  ANTHROPIC_API_KEY?: string; // secret — Claude, for summaries and expanding projects
  AI_MODEL?: string; // default claude-opus-5-5
  OPENAI_API_KEY?: string; // secret, optional — only for voice transcription
  OPENAI_TRANSCRIBE_MODEL?: string;
  ALLOWED_ORIGINS?: string; // comma-separated
  AI_HOURLY_LIMIT?: string; // per-user AI operations per hour
  AI_DAILY_COST_CAP_USD?: string; // per-user daily cap
  ENVIRONMENT?: string;
  APP_URL?: string; // where OAuth callbacks send the browser back to (default https://todos.jamry.us)
  API_URL?: string; // public origin of this Worker, for OAuth redirect URIs (default APP_URL)
  EMAIL_TOKEN_KEY?: string; // secret — base64 of 32 random bytes; encrypts mailbox tokens and passwords
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string; // secret
  MS_CLIENT_ID?: string;
  MS_CLIENT_SECRET?: string; // secret
}
