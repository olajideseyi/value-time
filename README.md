# Value Time

Value Time is a multi-user academic and personal productivity workspace. It brings study planning, timetables, courses, assignments, assessments, tasks, attendance, notes and reminders into one account-based system.

## Current capabilities

- Supabase Auth with per-user records protected by PostgreSQL Row Level Security.
- Course management with lecturer details and manual course progress tracking.
- Timetable week, day, month and detailed-table views, including weekly recurrence, selected weekdays, optional end dates, lecturer and venue details, and course links.
- Timetable overlap warnings and attendance records for individual class occurrences.
- Assignment and examination management linked to courses.
- Private assignment file submissions (PDF, Office documents and images; 20 MB limit) with temporary signed viewing links.
- Tasks with priorities, due dates, daily/weekly/monthly recurrence, and parent-linked subtasks.
- Reminders, configurable alarm tones, volume and repeat preferences.
- Focus sessions, productivity habits and habit entries.
- Notes and learning resources linked to courses.
- Personal data backup in JSON and calendar export in iCalendar (.ics) format. Calendar export is a one-way file export, not two-way Google Calendar synchronisation.
- Installable PWA support, in-app notifications and browser notification handling while the app is active.
- Separate scheduled Worker for email reminders, daily email briefings, recurring task generation, recurring timetable reminders and Web Push delivery.
- Web Push registration and test controls in Settings. Reliable delivery while the app is closed requires the separate reminder Worker to be deployed and its VAPID settings configured.
- Telegram delivery code remains optional and is intentionally deferred until account linking is implemented.

## Stack

- Next.js App Router + TypeScript + React
- Supabase Auth, PostgreSQL, Row Level Security and Storage
- Cloudflare Workers + OpenNext for the application
- A separate Cloudflare Cron Worker for scheduled reminders and notification delivery
- Resend for outbound email
- PWA manifest and service worker

## Supabase project

Project URL: `https://emcspruiboxkixcyokka.supabase.co`

Database migrations are in `supabase/migrations/`. They cover the core academic and productivity tables, private assignment-submission storage, ownership constraints, notes, push subscriptions, recurring task occurrences and task subtasks.

All user-facing public tables have Row Level Security enabled. Policies scope user data to the authenticated account. The assignment-submissions bucket is private; its Storage policies restrict access to the authenticated user's own folder.

Use the project's publishable key in the browser. Never expose the Supabase service-role or secret key in client code, GitHub source, or any `NEXT_PUBLIC_*` variable.

## Deploy the Next.js application

The repository includes the OpenNext Cloudflare adapter configuration. The production Cloudflare Workers build uses:

- Build command: `npx @opennextjs/cloudflare build`
- Deploy command: `npx @opennextjs/cloudflare deploy`
- Root directory: repository root

The application Worker needs the Supabase project URL and publishable key as public runtime/build variables.

## Deploy the scheduled reminder Worker

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
- `VAPID_PUBLIC_KEY` (public key, already declared in `workers/reminder-worker/wrangler.toml`)
- `VAPID_PRIVATE_JWK` (secret; never commit it to GitHub)
- `VAPID_SUBJECT` (a contact URI you control, e.g. `mailto:you@your-domain.example`)

Optional later:

- `TELEGRAM_BOT_TOKEN` (Telegram is deferred)

Web Push requires the browser to grant notification permission and save a subscription in Settings. The Worker encrypts push payloads and removes expired subscriptions. Email delivery requires a verified Resend sender. The main application Worker does not deploy this scheduled Worker automatically.

## Export and sync limitations

- JSON backup exports the supported account data. Uploaded assignment binaries must be downloaded separately; their storage paths are included in the backup.
- iCalendar export provides a file that can be imported into a calendar application. It is not a live, two-way Google Calendar connection.
- Push, email and scheduled reminders must be tested against the deployed Cloudflare Worker and the user's real device/account before they can be considered operational.

## Alarm and notification limitations

Browser audio must be unlocked by a user interaction. In-app sound and notification timers work while Value Time is open; browser timer throttling can delay them in background tabs. Background Web Push depends on browser/device support, notification permission, a valid push subscription and correct Worker configuration. Do not treat local browser alarms as a guaranteed replacement for an independent alarm clock.

## Development

```bash
npm install
npm run typecheck
npm run build
```
