# Value Time reminder worker

Runs every minute using the Cron Trigger in `wrangler.toml`. It generates reminders for upcoming one-off and recurring timetable events, tasks, assignments, and examinations; processes in-app alerts; delivers due email and Web Push notifications; generates the next daily, weekly, or monthly task occurrence when a recurring task is completed; and sends the user's scheduled daily planning briefing through Resend. It retries failed email/push deliveries up to three attempts. Daily briefings can include the timetable, tasks, assignments, and examinations. Telegram remains optional and is intentionally deferred.

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

The worker runs once per minute. It plans upcoming reminders 14 days ahead and creates in-app alerts for all supported activities. Email alerts are created when the user's email preference is enabled. Web Push alerts are created only for users with push enabled and a saved browser subscription. Default offsets are 30/10 minutes for timetable events, 24 hours/1 hour for tasks and assignments, and 24 hours/1 hour/15 minutes for examinations. Users can still configure timetable offsets in the timetable form. The Worker sends encrypted `aes128gcm` Web Push payloads and removes expired (404/410) subscriptions. Email reminders are marked failed with an explanatory delivery log if Resend is not configured. Verify a sending domain in Resend before expecting outbound delivery. The main app's Cloudflare deployment does not automatically deploy this separate Worker. Never put privileged keys in browser variables or GitHub source.


## Deployment checklist

After connecting the separate Worker to GitHub, open **Cloudflare Dashboard → Workers & Pages → value-time-reminder-worker → Settings → Variables and Secrets** and add these as encrypted secrets (not plain variables):

- `SUPABASE_SERVICE_ROLE_KEY`
- `RESEND_API_KEY`
- `VAPID_PRIVATE_JWK`

Add `EMAIL_FROM` as a variable using a sender address whose domain is verified in Resend, for example `Value Time <reminders@your-verified-domain>`. Do not use the example literally; use the sender address you actually verified.

Confirm these plain variables are present:

- `SUPABASE_URL`
- `VAPID_PUBLIC_KEY`
- `VAPID_SUBJECT`

Then deploy using the command above. In the Worker overview, verify the Cron Trigger shows `* * * * *`. Open Logs and confirm the scheduled jobs report `scheduled_job_ok` for `upcoming_item_reminders` and `pending_reminders`. Use Value Time Settings to queue a test email and a test push, then confirm receipt on the destination email/device. A successful queue action alone does not prove delivery.

Never paste service-role keys, Resend API keys, or VAPID private keys into GitHub source, a browser environment variable, or a chat message.
