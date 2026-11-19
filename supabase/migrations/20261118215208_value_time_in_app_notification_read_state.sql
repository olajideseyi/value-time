alter table public.reminders add column if not exists read_at timestamptz;
create index if not exists reminders_in_app_history_idx
  on public.reminders (user_id, sent_at desc)
  where channel = 'in_app' and status in ('sent','failed');