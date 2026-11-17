# Value Time reminder worker

Runs every minute using the Cron Trigger in `wrangler.toml`. It delivers due email reminders and sends the user's scheduled daily planning briefing through Resend. Daily briefings can include the timetable, tasks, assignments, and examinations. Telegram remains optional and is intentionally deferred.

## Deploy as a separate Cloudflare Worker

This is a separate scheduled Worker from the main Next.js application Worker.

1. In Cloudflare Workers & Pages, create a Worker connected to this GitHub repository.
2. Set the repository root directory to `workers/reminder-worker`.
3. Use `npx wrangler deploy` as the deploy command. The `wrangler.toml` file already defines the Worker entry point and a once-per-minute Cron Trigger.
4. In the Worker settings, add the secrets and variables below.
5. Deploy and check the Worker's Cron Trigger and invocation logs.

## Required Worker secrets / variables

- `SUPABASE_URL`: Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: privileged Supabase key; store only as a Worker secret.
- `RESEND_API_KEY`: Resend API key (Worker secret).
- `EMAIL_FROM`: verified sender identity, e.g. `Value Time <reminders@your-verified-domain>`.

Optional:
- `TELEGRAM_BOT_TOKEN`: add later when Telegram is configured.

Email reminders are marked failed with an explanatory delivery log if Resend is not configured. Verify a sending domain in Resend before expecting outbound delivery. The main app's Cloudflare deployment does not automatically deploy this separate Worker. Never put privileged keys in browser variables or GitHub source.
