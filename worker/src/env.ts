export interface Env {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string; // secret — used only for ai_operations logging and cron
  OPENAI_API_KEY: string; // secret
  OPENAI_MODEL?: string;
  OPENAI_TRANSCRIBE_MODEL?: string;
  ALLOWED_ORIGINS?: string; // comma-separated
  AI_HOURLY_LIMIT?: string; // per-user AI operations per hour
  AI_DAILY_COST_CAP_USD?: string; // per-user daily cap
  ENVIRONMENT?: string;
}
