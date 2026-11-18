# Value Time reminder worker

Runs every minute using the Cron Trigger in `wrangler.toml`. It generates the next daily, weekly, or monthly task occurrence when a recurring task is completed, delivers due email and Web Push reminders, creates rolling recurring timetable alerts, and sends the user's scheduled daily planning briefing through Resend. Daily briefings can include the timetable, tasks, assignments, and examinations. Telegram remains optional and is intentionally deferred.

## Deploy as a separate Cloudflare Worker

This is a separate scheduled Worker from the main Next.js application Worker.

1. In Cloudflare Workers & Pages, create a Worker connected to this GitHub repository.
2. Set the repository root directory to `workers/reminder-worker`.
3. Use `npx wrangler deploy --config workers/reminder-worker/wrangler.toml` as the deploy command. This explicit config path prevents the main app's root `wrangler.jsonc` from being selected. The `wrangler.toml` file already defines the Worker entry point and a once-per-minute Cron Trigger.
4. In the Worker settings, add the secrets and variables below.
5. Deploy and check the Worker's Cron Trigger and invocation logs.

## Required Worker secrets / variables

- `SUPABASE_URL`: Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: privileged Supabase key; store only as a Worker secret.
- `RESEND_API_KEY`: Resend API key (Worker secret).
- `EMAIL_FROM`: verified sender identity, e.g. `Value Time <reminders@your-verified-domain>`.
- `VAPID_PUBLIC_KEY`: public P-256 VAPID key, already declared in `wrangler.toml`.
- `VAPID_PRIVATE_JWK`: private VAPID JWK (Worker secret only; never commit it).
- `VAPID_SUBJECT`: a contact URI you control, e.g. `mailto:your-real-email@example.com` (add as a Worker variable).

Optional:
- `TELEGRAM_BOT_TOKEN`: add later when Telegram is configured.

Web Push reminders are queued only for users with a saved browser subscription. The Worker sends encrypted `aes128gcm` Web Push payloads and removes expired (404/410) subscriptions. Email reminders are marked failed with an explanatory delivery log if Resend is not configured. Verify a sending domain in Resend before expecting outbound delivery. The main app's Cloudflare deployment does not automatically deploy this separate Worker. Never put privileged keys in browser variables or GitHub source.
