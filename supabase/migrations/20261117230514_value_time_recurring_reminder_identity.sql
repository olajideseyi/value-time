alter table public.reminders
 add column if not exists occurrence_starts_at timestamptz,
 add column if not exists reminder_offset_minutes integer;

create unique index if not exists reminders_schedule_occurrence_unique_idx
 on public.reminders(user_id,target_id,occurrence_starts_at,reminder_offset_minutes,channel);