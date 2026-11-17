# Value Time

A multi-user productivity and academic automation platform: timetables, assignments, tasks, attendance, reminders and Telegram notifications.

## Stack
- Next.js App Router + TypeScript
- Supabase Auth + PostgreSQL with Row Level Security
- Cloudflare Workers + Cron for scheduled reminder delivery
- Telegram Bot API
- PWA-ready web application

## Supabase project
Project URL: `https://emcspruiboxkixcyokka.supabase.co`

1. Copy `.env.example` to `.env.local`.
2. Set `NEXT_PUBLIC_SUPABASE_ANON_KEY` to the project's publishable key from Supabase Dashboard → Project Settings → API Keys.
3. Run `npm install`, then `npm run dev`.

Never use the Supabase service-role key in browser or `NEXT_PUBLIC_*` variables.

## Database
Migrations are in `supabase/migrations/`. The initial schema creates profiles, preferences, courses, timetable entries, assignments, tasks, attendance, Telegram connection metadata, reminders and notification logs. Each user's data is protected by RLS ownership policies.

## Run locally
```bash
npm install
npm run dev
```

## Deploy the Next.js application to Cloudflare Workers
The repository includes the OpenNext Cloudflare adapter configuration.

1. Create `.env.local` using the Supabase URL and publishable key.
2. Authenticate Wrangler: `npx wrangler login`.
3. Preview the Workers build: `npm run preview`.
4. Deploy: `npm run deploy`.

## Deploy the scheduled Telegram reminder worker
From the repository root, set these Cloudflare Worker secrets using the separate worker configuration:
```bash
npx wrangler secret put SUPABASE_URL --config workers/reminder-worker/wrangler.toml
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --config workers/reminder-worker/wrangler.toml
npx wrangler secret put TELEGRAM_BOT_TOKEN --config workers/reminder-worker/wrangler.toml
npx wrangler deploy --config workers/reminder-worker/wrangler.toml
```

The service-role key and Telegram bot token must remain server-side secrets. The scheduled worker is a foundation; the user-facing Telegram account-linking flow and reminder creation screens are still being developed.
