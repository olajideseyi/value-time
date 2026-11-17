# Value Time Reminder Worker

Deploy from this directory with Wrangler after setting secrets:

```bash
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler deploy
```

The Worker checks due Telegram reminders every minute. Keep the service-role key and bot token in Worker secrets only; never put them in Next.js public environment variables.

This is the initial scheduled-delivery foundation. Telegram account linking, retry/backoff, push delivery and the in-app reminder creation interface are follow-up implementation items.
