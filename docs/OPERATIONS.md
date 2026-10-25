# Operations

## Environments

| | Development | Production |
|---|---|---|
| Supabase | separate project (e.g. `momentum-dev`) | `momentum` project |
| Worker | `wrangler deploy --env dev` → `momentum-api-dev.<account>.workers.dev` | `wrangler deploy` → `todos.jamry.us/api/*` |
| Web | `npx expo start --web` (localhost:8081) | Cloudflare Pages project `momentum`, custom domain `todos.jamry.us` |
| Cron | off | daily 13:17 UTC |

## Environment variables

**App** (`app/.env`, public; RLS makes them safe to ship)

| Name | Example |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | `https://abcd.supabase.co` |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | anon / publishable key |
| `EXPO_PUBLIC_API_URL` | optional. Web defaults to same-origin `/api`; native defaults to `https://todos.jamry.us` |

**Worker** (`worker/wrangler.toml` vars + secrets)

| Name | Kind | Notes |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | var | |
| `SUPABASE_SERVICE_ROLE_KEY` | **secret** | `wrangler secret put SUPABASE_SERVICE_ROLE_KEY` |
| `ANTHROPIC_API_KEY` | **secret** | Claude, for summaries and expanding projects: `wrangler secret put ANTHROPIC_API_KEY` (create the key at console.anthropic.com). Organizing never needs it. |
| `AI_MODEL` | var | default `claude-opus-5-5` |
| `OPENAI_API_KEY` | **secret**, optional | only for the Speak button's transcription on iPhone/Android |
| `OPENAI_TRANSCRIBE_MODEL` | var | default `gpt-4o-mini-transcribe` |
| `ALLOWED_ORIGINS` | var | `https://todos.jamry.us` |
| `AI_HOURLY_LIMIT` | var | per user, default 60 |
| `AI_DAILY_COST_CAP_USD` | var | per user, default 1.00 |
| `APP_URL` | var | where OAuth sends the browser back, `https://todos.jamry.us` |
| `EMAIL_TOKEN_KEY` | **secret** | base64 of 32 random bytes; encrypts mailbox tokens and IMAP passwords. Rotating it means users reconnect. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | var / **secret** | optional; enables "Sign in with Google" for Gmail |
| `MS_CLIENT_ID` / `MS_CLIENT_SECRET` | var / **secret** | optional; enables Outlook / Microsoft 365 |

**GitHub Actions** (`.github/workflows/deploy.yml`): set the secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `SUPABASE_DB_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `OPENAI_API_KEY`, and the variables `SUPABASE_URL` and `SUPABASE_ANON_KEY`. CI pushes the two Worker secrets and creates the Pages project if it is missing. Every push to `main` runs the tests, applies migrations, deploys the Worker, and builds and deploys Pages.

## First production deploy

1. **Supabase:** create the project. Under Auth → URL Configuration set the Site URL to `https://todos.jamry.us`. Run `supabase db push`.
2. **Cloudflare Pages:** create the project `momentum` (Direct Upload). Under Custom domains, add `todos.jamry.us`.
3. **Worker:** in `worker/`, run `wrangler secret put SUPABASE_SERVICE_ROLE_KEY`, then `wrangler secret put OPENAI_API_KEY`, then `wrangler deploy`. The route `todos.jamry.us/api/*` takes precedence over Pages for API paths.
4. **Web:** in `app/`, run `npm run build:web && npx wrangler pages deploy dist --project-name momentum`.
5. **Check:** `curl https://todos.jamry.us/api/health` → `{"ok":true,"ai":true,...}`.
6. **iOS:** `npx eas build -p ios --profile production`, then `eas submit`.

## Email setup

Users can connect any number of inboxes: Gmail and Outlook through OAuth, and anything else (iCloud, Yahoo, Fastmail, custom domains) over IMAP with an app password. IMAP only needs `EMAIL_TOKEN_KEY`. The two OAuth providers each need an app registration:

1. **Key:** `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` → GitHub secret `EMAIL_TOKEN_KEY`.
2. **Google:** in Google Cloud Console, enable the Gmail API, configure the OAuth consent screen, and create a *Web application* client with the redirect URI `https://todos.jamry.us/api/email/oauth/callback`. Scopes: `openid`, `email`, `https://www.googleapis.com/auth/gmail.modify`. Set the GitHub variable `GOOGLE_CLIENT_ID` and the secret `GOOGLE_CLIENT_SECRET`. `gmail.modify` is a *restricted* scope: while the app is in "Testing" it works for up to 100 listed test users. Going public needs Google's verification and a security assessment.
3. **Microsoft:** in Entra ID → App registrations, create an app for *accounts in any organizational directory and personal Microsoft accounts* with the Web redirect URI above. Add delegated permissions `offline_access`, `openid`, `email`, `User.Read` and `Mail.ReadWrite`, and create a client secret. Set the GitHub variable `MS_CLIENT_ID` and the secret `MS_CLIENT_SECRET`. Secrets expire (24 months max), so put a renewal reminder on the calendar.
4. **Check:** `curl https://todos.jamry.us/api/health` reports `"email":{"gmail":true,"outlook":true,"imap":true}`.

What is stored: message metadata (sender, subject, a provider preview of 600 characters at most), AI summaries, and categories. Bodies are never stored; whole threads are fetched only when a user taps *Summarize the whole thread*. Tokens and passwords are AES-GCM encrypted in `email_credentials`, which has RLS on and no policies, so only the Worker's service role can read it. The daily cron syncs every inbox, triages new mail, and writes the morning digest.

## Monitoring and costs

- **AI usage:** `select operation, count(*), sum(cost_usd) from ai_operations where created_at > now() - interval '30 days' group by 1;`. Settings → AI Preferences shows a 30-day total.
- **Worker logs:** Cloudflare dashboard → Workers → momentum-api → Logs (observability is enabled). Logs carry error codes only.
- **Estimated monthly cost for one person:**
  - Supabase Free tier: $0, or Pro at $25 if you want daily backups and no pausing.
  - Cloudflare Workers Free and Pages: $0.
  - OpenAI with `gpt-5-mini`: about $0.001–0.003 per capture or decomposition. At around 20 AI calls a day that is roughly **$1–2 a month**. Transcription is about $0.003 per minute.
  - The per-user daily cap (default $1) is a hard ceiling.

## Backup and recovery

- Supabase Pro includes daily backups, plus point-in-time recovery as an add-on. On the Free tier, schedule `supabase db dump -f backup.sql --data-only` (for example in a GitHub Action) and store it privately.
- **User-level export:** Settings → Privacy & Data → Export downloads all data as JSON (`export_my_data()`).
- **Restore:** create a new project, run `supabase db push`, then `psql "$DB_URL" -f backup.sql`.

## Verification done

- 13 core unit tests and 8 Worker tests, all passing. App and Worker typecheck clean.
- Migrations applied to Postgres 16 with an `auth` schema stub. Checks covered: RLS isolation between two users, `complete_action` idempotency, retroactive `occurred_at`, history surviving archiving, and `commit_capture` replay producing no duplicates.
- Web build exported and rendered in headless Chromium against mocked data: all screens, plus the AI-unavailable capture fallback.

## Known limitations / next steps

- Not yet tested against a live Supabase project, a live OpenAI key, or a physical iOS device.
- Push notifications: preferences are stored and check-ins appear in the app. Device push (Expo Notifications, plus a sender in the cron) is Phase 2.
- Photo and file attachments are stubbed in the UI (a future phase in the scope).
- Personalization records feedback and applies it to rest suggestions and lower scores. Richer learned preferences are Phase 2.
- Dates are typed as `YYYY-MM-DD`. A native date picker would be a nice upgrade.
- Light theme only.
