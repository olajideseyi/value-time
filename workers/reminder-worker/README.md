# Value Time reminder worker

Runs every minute using Cloudflare Cron Triggers and delivers due email reminders through Resend. Telegram remains optional and is intentionally deferred.

## Required Worker secrets / variables

- `SUPABASE_URL`: Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY`: privileged Supabase key; store only as a Worker secret.
- `RESEND_API_KEY`: Resend API key (Worker secret).
- `EMAIL_FROM`: verified sender identity, e.g. `Value Time <reminders@your-verified-domain>`.

Optional:
- `TELEGRAM_BOT_TOKEN`: add later when Telegram is configured.

Email reminders are marked failed with an explanatory delivery log if Resend is not configured. Verify a sending domain in Resend before expecting outbound delivery. Never put privileged keys in browser variables or GitHub source.
