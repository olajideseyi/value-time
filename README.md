# Value Time

Value Time is a multi-user academic and personal productivity workspace. It brings timetables, courses, assignments, assessments, tasks, attendance and reminders into one account-based system.

## Current capabilities

- Supabase Auth with private, user-owned records protected by Row Level Security.
- Course management with lecturer details and manual course progress tracking.
- Timetable week, day, month and detailed-table views.
- Weekly recurring classes on selected weekdays, optional recurrence end dates, lecturer and venue details, and course links.
- Timetable overlap warnings and attendance records for individual class occurrences.
- Assignment and examination management linked to courses.
- Private assignment file submissions (PDF, Office documents and images; 20 MB limit) with temporary signed viewing links.
- Tasks, reminders, configurable alarm tones, volume and repeat preferences.
- Installable PWA support and browser notifications while the application is active.
- Scheduled email reminders and configurable daily email briefings through the separate reminder Worker.
- Telegram delivery code remains optional and is intentionally deferred until account linking is implemented.

## Stack

- Next.js App Router + TypeScript
- Supabase Auth, PostgreSQL, Row Level Security and Storage
- Cloudflare Workers + OpenNext for the application
- A separate Cloudflare Cron Worker for email reminders and daily briefings
- Resend for outbound email
- PWA manifest and service worker

## Supabase project

Project URL: `https://emcspruiboxkixcyokka.supabase.co`

Database migrations are in `supabase/migrations/`. They cover profiles, preferences, courses, timetable entries, assignments, tasks, attendance, examinations, reminders, notification logs and private assignment-submission storage.

All user-facing tables use ownership policies. The assignment-submissions bucket is private; its Storage policies restrict access to the authenticated user's own folder.

Use the project's publishable key in the browser. Never expose the Supabase service-role or secret key in client code, GitHub source, or any `NEXT_PUBLIC_*` variable.

## Deploy the Next.js application

The repository includes the OpenNext Cloudflare adapter configuration. The production Cloudflare Workers build uses:

- Build command: `npx @opennextjs/cloudflare build`
- Deploy command: `npx @opennextjs/cloudflare deploy`
- Root directory: repository root

The application Worker needs the Supabase project URL and publishable key as public runtime/build variables.

## Deploy the scheduled reminder and email Worker

The scheduled Worker is separate from the Next.js application Worker. Its configuration is `workers/reminder-worker/wrangler.toml` and runs once per minute.

Deploy it from the repository root with:

```bash
npx wrangler deploy --config workers/reminder-worker/wrangler.toml
```

Configure these Worker secrets/variables in Cloudflare:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (secret; server-side only)
- `RESEND_API_KEY` (secret)
- `EMAIL_FROM` (a sender identity verified with Resend)

Optional later:
- `TELEGRAM_BOT_TOKEN` (Telegram is deferred)

The Worker retrieves the recipient address from Supabase Auth and sends due email reminders and daily planning briefings. Email delivery is not live until the separate Worker is deployed, the required secrets are configured, and the sender domain is verified in Resend. The main application Worker does not deploy this scheduled Worker automatically.

## Alarm and notification limitations

Browser audio must be unlocked by a user interaction. In-app sound and notification timers work while Value Time is open; browser timer throttling can delay them in background tabs. Reliable delivery while the app is fully closed requires Web Push subscriptions and server-side push delivery, which are a remaining Stage 1 task. Do not treat local browser alarms as a guaranteed replacement for an independent alarm clock.

## Development

```bash
npm install
npm run typecheck
npm run build
```
