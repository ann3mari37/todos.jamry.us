# Operations

## Environments

| | Development | Production |
|---|---|---|
| Supabase | separate project (e.g. `momentum-dev`) | `momentum` project |
| Worker + web | `wrangler deploy --env dev` → `momentum-api-dev.<account>.workers.dev` (API only) | Worker `momentum-api` on `todos.jamry.us/*`: serves the web app from `app/dist` and the API on `/api/*` |
| Web (local) | `npx expo start --web` (localhost:8081) | built into the Worker on every deploy |
| Cron | off | daily 13:17 UTC |

## Environment variables

**App** (`app/.env.production` is committed and used by production builds; `app/.env.local` for your machine. Public; RLS makes them safe to ship)

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

Secrets live only in Cloudflare (`wrangler secret put NAME` in `worker/`, or the dashboard: Workers & Pages → momentum-api → Settings → Variables and Secrets) and survive every deploy. Plain vars belong in `wrangler.toml`: each deploy replaces vars set in the dashboard with the file's.

## Automatic deploys

Cloudflare Workers Builds deploys `main`; GitHub holds no secrets. Every push to `main`:

- **GitHub Actions** (`.github/workflows/deploy.yml`) runs the type checks and tests, so a red ✗ on the commit means something is broken.
- **Cloudflare** builds the web app and deploys the Worker with it.

One-time setup in the Cloudflare dashboard: Workers & Pages → `momentum-api` → Settings → Builds → Connect, pick the GitHub repo, then:

| Setting | Value |
|---|---|
| Production branch | `main` |
| Root directory | `worker` |
| Build command | `npm ci && npm run build:app` |
| Deploy command | `npx wrangler deploy` |
| Non-production branch builds | off |

Database migrations are not automatic: apply new files in `supabase/migrations/` with `supabase db push` or by pasting them into the Supabase SQL editor before pushing code that needs them.

## First production deploy

1. **Supabase:** create the project. Under Auth → URL Configuration set the Site URL to `https://todos.jamry.us`. Run `supabase db push`.
2. **Worker:** in `worker/`, run `wrangler secret put SUPABASE_ANON_KEY`, `wrangler secret put SUPABASE_SERVICE_ROLE_KEY` and `wrangler secret put ANTHROPIC_API_KEY`, then `npm run build:app && npx wrangler deploy`. The route `todos.jamry.us/*` serves the whole site.
3. **Auto-deploy:** connect the repo as described under Automatic deploys.
4. **Check:** `curl https://todos.jamry.us/api/health` → `{"ok":true,"ai":true,...}`.
5. **iOS:** `npx eas build -p ios --profile production`, then `eas submit`.

## Email setup

Users can connect any number of inboxes: Gmail and Outlook through OAuth, and anything else (iCloud, Yahoo, Fastmail, custom domains) over IMAP with an app password. IMAP only needs `EMAIL_TOKEN_KEY`. The two OAuth providers each need an app registration:

1. **Key:** `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"` → `wrangler secret put EMAIL_TOKEN_KEY`.
2. **Google:** in Google Cloud Console, enable the Gmail API, configure the OAuth consent screen, and create a *Web application* client with the redirect URI `https://todos.jamry.us/api/email/oauth/callback`. Scopes: `openid`, `email`, `https://www.googleapis.com/auth/gmail.modify`. Add `GOOGLE_CLIENT_ID` to `[vars]` in `wrangler.toml` and run `wrangler secret put GOOGLE_CLIENT_SECRET`. `gmail.modify` is a *restricted* scope: while the app is in "Testing" it works for up to 100 listed test users. Going public needs Google's verification and a security assessment.
3. **Microsoft:** in Entra ID → App registrations, create an app for *accounts in any organizational directory and personal Microsoft accounts* with the Web redirect URI above. Add delegated permissions `offline_access`, `openid`, `email`, `User.Read` and `Mail.ReadWrite`, and create a client secret. Add `MS_CLIENT_ID` to `[vars]` in `wrangler.toml` and run `wrangler secret put MS_CLIENT_SECRET`. Secrets expire (24 months max), so put a renewal reminder on the calendar.
4. **Check:** `curl https://todos.jamry.us/api/health` reports `"email":{"gmail":true,"outlook":true,"imap":true}`.

What is stored: message metadata (sender, subject, a provider preview of 600 characters at most), AI summaries, and categories. Bodies are never stored; whole threads are fetched only when a user taps *Summarize the whole thread*. Tokens and passwords are AES-GCM encrypted in `email_credentials`, which has RLS on and no policies, so only the Worker's service role can read it. The daily cron syncs every inbox, triages new mail, and writes the morning digest.

## Monitoring and costs

- **AI usage:** `select operation, count(*), sum(cost_usd) from ai_operations where created_at > now() - interval '30 days' group by 1;`. Settings → AI Preferences shows a 30-day total.
- **Worker logs:** Cloudflare dashboard → Workers → momentum-api → Logs (observability is enabled). Logs carry error codes only.
- **Estimated monthly cost for one person:**
  - Supabase Free tier: $0, or Pro at $25 if you want daily backups and no pausing.
  - Cloudflare Workers Free (including static assets and Workers Builds): $0.
  - Claude: only summaries and project expansion call it; organizing runs on rules. Optional OpenAI transcription is about $0.003 per minute.
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
