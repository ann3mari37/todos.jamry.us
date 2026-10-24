# Momentum

*Small steps. Big change.* An AI-assisted personal progress and task manager. It focuses on meaningful accomplishments and forward momentum rather than deadlines, task counts or streaks.

| Layer | Tech | Where |
|---|---|---|
| App (iOS, Android, web) | Expo SDK 58 · React Native · TypeScript · expo-router | `app/` |
| API + scheduled jobs | Cloudflare Worker (+ Cron Trigger) | `worker/` |
| Auth + database | Supabase Auth · Postgres with Row Level Security | `supabase/migrations/` |
| AI | OpenAI API (structured outputs, validated server-side) | `worker/src/` |
| Web hosting | Cloudflare Pages at **https://todos.jamry.us** (API on `todos.jamry.us/api/*`) | |

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the design, the data model, the API and AI contracts. See [`docs/OPERATIONS.md`](docs/OPERATIONS.md) for deployment, environments, secrets, costs, backups and known limitations.

## Quick start from a clean machine

Prerequisites: Node 22+, a Supabase account, a Cloudflare account with the `jamry.us` zone, and an OpenAI API key.

```bash
git clone <this repo> momentum && cd momentum

# 1. Database: create a Supabase project, then apply the migrations
npx supabase link --project-ref <ref>
npx supabase db push            # applies supabase/migrations/*

# 2. API worker (local)
cd worker && npm install
cp .dev.vars.example .dev.vars  # fill in your dev Supabase + OpenAI values
npx wrangler dev --env dev      # http://localhost:8787

# 3. App (local)
cd ../app && npm install
cp .env.example .env            # EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY, EXPO_PUBLIC_API_URL=http://localhost:8787
npx expo start                  # press w for web, i for iOS simulator, or scan with Expo Go
```

## Tests

```bash
cd app && npx tsc --noEmit && npx vitest run      # recommendation engine, accountability, capture, AI contracts
cd worker && npx tsc --noEmit && npx vitest run   # auth, CORS, limits, AI output validation, fallback
```

The database functions and RLS policies were also exercised against Postgres 16, covering completion idempotency, retroactive dates, history surviving archiving, cross-user isolation and capture replay. See `docs/OPERATIONS.md`.

## Using it on your phone

- **Web:** open https://todos.jamry.us in Safari, then Share → *Add to Home Screen*.
- **Native iOS:** `cd app && npx eas build -p ios`, then install through TestFlight. Cloudflare hosts only the web app and the API, not the native binary.
