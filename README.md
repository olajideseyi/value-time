# Value Time

A multi-user productivity and academic automation platform.

## Stack
- Next.js App Router + TypeScript
- Supabase Auth + PostgreSQL (Row Level Security)
- Telegram Bot API (server-side integration)
- Cloudflare Workers Cron for scheduled reminders
- PWA + Web Audio API for device-side alarms

## Getting started
1. Copy `.env.example` to `.env.local`.
2. Add your Supabase project URL and anon/publishable key.
3. Run `npm install` and `npm run dev`.

## Database
The initial schema is in `supabase/migrations/202611170001_value_time_core_schema.sql`.
It provisions per-user profiles, preferences, courses, timetable entries, assignments, tasks, attendance, Telegram connection metadata, reminders and notification logs. All personal tables have Row Level Security policies.

## Security
Never expose the Supabase service-role key or Telegram bot token in browser code. Telegram bot secrets belong in Cloudflare Worker secrets.
